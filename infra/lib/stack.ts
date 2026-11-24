import { CfnOutput, Duration, RemovalPolicy, Stack, TimeZone, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { CfnStage, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { LambdaInvoke, SqsSendMessage } from 'aws-cdk-lib/aws-scheduler-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement, User } from 'aws-cdk-lib/aws-iam';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { fileURLToPath } from 'node:url';
import { PARAMS } from '../../packages/core/src/params.js';

const lambdaSrc = (file: string) => fileURLToPath(new URL(`../../services/lambda/src/handlers/${file}`, import.meta.url));

// Chart PNGs: resvg's wasm and the Inter font are read from beside the bundle at runtime.
const CHART_ASSETS = [
  '@resvg/resvg-wasm/index_bg.wasm',
  '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
  '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
];

export class AssistantStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { allowlist: string; llmProvider: string }) {
    super(scope, id, props);

    const fn = (name: string, file: string, timeout: number, memorySize = 1024) =>
      new NodejsFunction(this, name, {
        entry: lambdaSrc(file),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize,
        timeout: Duration.seconds(timeout),
        logRetention: RetentionDays.ONE_WEEK,
        bundling: { format: OutputFormat.ESM, target: 'node22', sourceMap: true,
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (_in: string, out: string) => CHART_ASSETS.map((a) => `cp ${fileURLToPath(new URL(`../../node_modules/${a}`, import.meta.url))} ${out}/`),
          },
          // ESM bundles need a real `require` for the few CJS deps that call it.
          banner: "import { createRequire as __bannerRequire } from 'module'; const require = __bannerRequire(import.meta.url);" },
        environment: { ALLOWLIST: props.allowlist, NODE_OPTIONS: '--enable-source-maps' },
      });

    // SecureStrings are created out of band by scripts/setup-secrets.ts (CloudFormation can't create them).
    const grantParams = (to: IFunction, names: string[]) => {
      for (const name of names) {
        StringParameter.fromSecureStringParameterAttributes(this, `${to.node.id}${name.replace(/\W/g, '')}`, { parameterName: name }).grantRead(to);
      }
    };

    // FIFO + per-number group id keeps a conversation strictly ordered.
    const secureQueue = { encryption: QueueEncryption.SQS_MANAGED, enforceSSL: true };
    const inboundDlq = new Queue(this, 'InboundDlq', { fifo: true, retentionPeriod: Duration.days(4), ...secureQueue });
    const inbound = new Queue(this, 'Inbound', {
      fifo: true,
      ...secureQueue,
      // Lets the scheduler enqueue without an explicit dedup id; ingress still sets its own.
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.seconds(6 * 60),
      deadLetterQueue: { queue: inboundDlq, maxReceiveCount: 2 },
    });
    // Short retention: a reply that hasn't reached the Mac within a day is stale.
    const outbound = new Queue(this, 'Outbound', { fifo: true, visibilityTimeout: Duration.seconds(60), retentionPeriod: Duration.days(1), ...secureQueue });

    const ingress = fn('Ingress', 'ingress.ts', 10);
    ingress.addEnvironment('INBOUND_QUEUE_URL', inbound.queueUrl);
    inbound.grantSendMessages(ingress);
    grantParams(ingress, [PARAMS.bridgeSecret]);

    // Photos texted to the assistant, and generated charts. Private; the bridge only gets 1-hour presigned links.
    const files = new Bucket(this, 'Files', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Texted-in photos and charts expire; the capybara stash (stash/) is kept.
      lifecycleRules: [
        { prefix: 'inbound/', expiration: Duration.days(30) },
        { prefix: 'charts/', expiration: Duration.days(30) },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Typical turns take 3-20s; a tight timeout keeps a stuck turn from blocking the FIFO group for long.
    const agent = fn('Agent', 'agent.ts', 90);
    agent.addEnvironment('FILES_BUCKET', files.bucketName);
    files.grantReadWrite(agent);
    agent.addEnvironment('OUTBOUND_QUEUE_URL', outbound.queueUrl);
    agent.addEnvironment('LLM_PROVIDER', props.llmProvider);
    grantParams(agent, [PARAMS.mongoUri, PARAMS.anthropicKey, PARAMS.stateSecret, PARAMS.googleClient, PARAMS.tokenKey, PARAMS.canvas]);
    // Only used when LLM_PROVIDER=bedrock. us.* inference profiles fan out to several regions.
    agent.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [`arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.*`, 'arn:aws:bedrock:*::foundation-model/anthropic.*'],
    }));
    agent.addEventSource(new SqsEventSource(inbound, { batchSize: 1 }));
    outbound.grantSendMessages(agent);

    const api = new HttpApi(this, 'Api');
    // One person texts a few times a minute; cap everything else (cost and abuse protection).
    (api.defaultStage!.node.defaultChild as CfnStage).defaultRouteSettings = { throttlingRateLimit: 5, throttlingBurstLimit: 10 };
    api.addRoutes({ path: '/inbound', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('IngressInt', ingress) });

    // Morning briefing goes straight onto the inbound queue: no extra Lambda, same ordering guarantees.
    const owner = props.allowlist.split(',')[0]!.trim();
    new Schedule(this, 'MorningBriefing', {
      schedule: ScheduleExpression.cron({ minute: '0', hour: '8', timeZone: TimeZone.AMERICA_NEW_YORK }),
      target: new SqsSendMessage(inbound, {
        messageGroupId: owner,
        input: ScheduleTargetInput.fromObject({ kind: 'event', type: 'morning_briefing', eventId: 'briefing-<aws.scheduler.scheduled-time>' }),
      }),
    });

    // Reminders and Canvas deadline nudges: a small every-minute check that only wakes the agent when something is due.
    const ticker = fn('Ticker', 'ticker.ts', 50, 256);
    ticker.addEnvironment('INBOUND_QUEUE_URL', inbound.queueUrl);
    inbound.grantSendMessages(ticker);
    grantParams(ticker, [PARAMS.mongoUri, PARAMS.canvas]);
    // Capybara drops: the ticker stocks stash/ from capy.lol and sends pics straight to the outbound queue.
    ticker.addEnvironment('FILES_BUCKET', files.bucketName);
    ticker.addEnvironment('OUTBOUND_QUEUE_URL', outbound.queueUrl);
    files.grantRead(ticker, 'stash/*');
    files.grantPut(ticker, 'stash/*');
    outbound.grantSendMessages(ticker);
    new Schedule(this, 'Tick', {
      schedule: ScheduleExpression.rate(Duration.minutes(1)),
      target: new LambdaInvoke(ticker, { retryAttempts: 0 }),
    });

    // Google OAuth: the owner approves access in a browser and Google redirects here.
    const googleRedirect = `${api.apiEndpoint}/google/callback`;
    const googleCallback = fn('GoogleCallback', 'googleCallback.ts', 20);
    googleCallback.addEnvironment('GOOGLE_REDIRECT_URI', googleRedirect);
    googleCallback.addEnvironment('OUTBOUND_QUEUE_URL', outbound.queueUrl);
    outbound.grantSendMessages(googleCallback);
    grantParams(googleCallback, [PARAMS.mongoUri, PARAMS.stateSecret, PARAMS.googleClient, PARAMS.tokenKey]);
    api.addRoutes({ path: '/google/callback', methods: [HttpMethod.GET], integration: new HttpLambdaIntegration('GoogleCallbackInt', googleCallback) });
    agent.addEnvironment('GOOGLE_REDIRECT_URI', googleRedirect);

    // The Mac bridge's own identity: long-lived key (no expiring sign-in), and it can only pick up replies
    // and upload texted photos. The access key is made with the CLI so its secret never lands in CloudFormation.
    const bridge = new User(this, 'Bridge');
    outbound.grantConsumeMessages(bridge);
    files.grantPut(bridge, 'inbound/*');
    new CfnOutput(this, 'BridgeUserName', { value: bridge.userName });

    new CfnOutput(this, 'IngressUrl', { value: `${api.apiEndpoint}/inbound` });
    new CfnOutput(this, 'OutboundQueueUrl', { value: outbound.queueUrl });
    new CfnOutput(this, 'GoogleRedirectUri', { value: googleRedirect });
    new CfnOutput(this, 'FilesBucket', { value: files.bucketName });
  }
}
