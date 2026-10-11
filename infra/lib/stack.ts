import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { CfnStage, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { SqsSendMessage } from 'aws-cdk-lib/aws-scheduler-targets';
import { TimeZone } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';

const lambdaSrc = (file: string) => fileURLToPath(new URL(`../../services/lambda/src/handlers/${file}`, import.meta.url));

export const BRIDGE_SECRET_PARAM = '/coord/bridge-secret';
const CHART_ASSETS = [
  '@resvg/resvg-wasm/index_bg.wasm',
  '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
];
const SECRET_PARAMS = ['/coord/mongodb-uri', '/coord/anthropic-api-key', '/coord/dashboard-secret'];
const DASHBOARD_SECRET_PARAM = '/coord/dashboard-secret';

export class CoordinatorStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { allowlist: string; llmProvider: string }) {
    super(scope, id, props);

    const fn = (name: string, file: string, timeout: number) =>
      new NodejsFunction(this, name, {
        entry: lambdaSrc(file),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 1024,
        timeout: Duration.seconds(timeout),
        logRetention: RetentionDays.ONE_WEEK,
        bundling: { format: OutputFormat.ESM, target: 'node22', sourceMap: true,
          // Chart PNGs: resvg's wasm and the Inter font are read from beside the bundle at runtime.
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (_in: string, out: string) =>
              CHART_ASSETS.map((a) => `cp ${fileURLToPath(new URL(`../../node_modules/${a}`, import.meta.url))} ${out}/`),
          },
          // ESM bundles need a real `require` for the few CJS deps that call it.
          banner: "import { createRequire as __bannerRequire } from 'module'; const require = __bannerRequire(import.meta.url);" },
        environment: { COORDINATOR_ALLOWLIST: props.allowlist, NODE_OPTIONS: '--enable-source-maps' },
      });

    // FIFO + per-coordinator group id keeps a conversation strictly ordered.
    const secureQueue = { encryption: QueueEncryption.SQS_MANAGED, enforceSSL: true };
    const inboundDlq = new Queue(this, 'InboundDlq', { fifo: true, retentionPeriod: Duration.days(4), ...secureQueue });
    const inbound = new Queue(this, 'Inbound', {
      fifo: true,
      ...secureQueue,
      // Lets the scheduler enqueue without an explicit dedup id; ingress still sets its own.
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.seconds(6 * 120),
      deadLetterQueue: { queue: inboundDlq, maxReceiveCount: 2 },
    });
    const outbound = new Queue(this, 'Outbound', { fifo: true, visibilityTimeout: Duration.seconds(60), ...secureQueue });

    const bridgeSecret = StringParameter.fromSecureStringParameterAttributes(this, 'BridgeSecret', {
      parameterName: BRIDGE_SECRET_PARAM,
    });

    const ingress = fn('Ingress', 'ingress.ts', 10);
    ingress.addEnvironment('INBOUND_QUEUE_URL', inbound.queueUrl);
    ingress.addEnvironment('BRIDGE_SECRET_PARAM', BRIDGE_SECRET_PARAM);
    inbound.grantSendMessages(ingress);
    bridgeSecret.grantRead(ingress);

    // Generated PDFs, .ics files and received form photos. Private; the bridge only gets 1-hour presigned links.
    const files = new Bucket(this, 'Files', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Hackathon stack: synthetic data only, so tearing down should leave nothing behind.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const agent = fn('Agent', 'agent.ts', 120);
    agent.addEnvironment('FILES_BUCKET', files.bucketName);
    files.grantReadWrite(agent);
    agent.addEnvironment('OUTBOUND_QUEUE_URL', outbound.queueUrl);
    agent.addEnvironment('LLM_PROVIDER', props.llmProvider);
    for (const name of SECRET_PARAMS) {
      StringParameter.fromSecureStringParameterAttributes(this, `Param${name.replace(/\W/g, '')}`, { parameterName: name }).grantRead(agent);
    }
    // us.* inference profiles fan out to several regions, so both ARNs are needed across regions.
    agent.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.*`,
        'arn:aws:bedrock:*::foundation-model/anthropic.*',
        'arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2*',
      ],
    }));
    agent.addEventSource(new SqsEventSource(inbound, { batchSize: 1 }));
    outbound.grantSendMessages(agent);

    const api = new HttpApi(this, 'Api');
    // One coordinator texts a few times a minute; cap everything else (cost and abuse protection).
    (api.defaultStage!.node.defaultChild as CfnStage).defaultRouteSettings = { throttlingRateLimit: 5, throttlingBurstLimit: 10 };
    const ingressInt = new HttpLambdaIntegration('IngressInt', ingress);
    api.addRoutes({ path: '/inbound', methods: [HttpMethod.POST], integration: ingressInt });
    api.addRoutes({ path: '/events', methods: [HttpMethod.POST], integration: ingressInt });

    // Morning check goes straight onto the inbound queue: no extra Lambda, same ordering guarantees.
    const firstCoordinator = props.allowlist.split(',')[0]!.trim();
    new Schedule(this, 'DailyCheck', {
      schedule: ScheduleExpression.cron({ minute: '0', hour: '8', timeZone: TimeZone.AMERICA_NEW_YORK }),
      target: new SqsSendMessage(inbound, {
        messageGroupId: firstCoordinator,
        input: ScheduleTargetInput.fromObject({ kind: 'event', type: 'daily_check', eventId: 'daily-<aws.scheduler.scheduled-time>' }),
      }),
    });

    // Live dashboard behind signed, expiring links the agent texts to the coordinator.
    const dashboard = fn('Dashboard', 'dashboard.ts', 15);
    dashboard.addEnvironment('DASHBOARD_SECRET_PARAM', DASHBOARD_SECRET_PARAM);
    for (const name of ['/coord/mongodb-uri', DASHBOARD_SECRET_PARAM]) {
      StringParameter.fromSecureStringParameterAttributes(this, `DashParam${name.replace(/\W/g, '')}`, { parameterName: name }).grantRead(dashboard);
    }
    const dashInt = new HttpLambdaIntegration('DashboardInt', dashboard);
    api.addRoutes({ path: '/dashboard', methods: [HttpMethod.GET], integration: dashInt });
    api.addRoutes({ path: '/dashboard/data', methods: [HttpMethod.GET], integration: dashInt });
    agent.addEnvironment('DASHBOARD_URL', `${api.apiEndpoint}/dashboard`);
    agent.addEnvironment('DASHBOARD_SECRET_PARAM', DASHBOARD_SECRET_PARAM);

    new CfnOutput(this, 'IngressUrl', { value: `${api.apiEndpoint}/inbound` });
    new CfnOutput(this, 'OutboundQueueUrl', { value: outbound.queueUrl });
    new CfnOutput(this, 'FilesBucket', { value: files.bucketName });
  }
}
