import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Schedule, ScheduleExpression, ScheduleTargetInput } from 'aws-cdk-lib/aws-scheduler';
import { SqsSendMessage } from 'aws-cdk-lib/aws-scheduler-targets';
import { TimeZone } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { fileURLToPath } from 'node:url';

const lambdaSrc = (file: string) => fileURLToPath(new URL(`../../services/lambda/src/handlers/${file}`, import.meta.url));

export const BRIDGE_SECRET_PARAM = '/coord/bridge-secret';
const SECRET_PARAMS = ['/coord/mongodb-uri', '/coord/anthropic-api-key'];

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
          // ESM bundles need a real `require` for the few CJS deps that call it.
          banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
        environment: { COORDINATOR_ALLOWLIST: props.allowlist, NODE_OPTIONS: '--enable-source-maps' },
      });

    // FIFO + per-coordinator group id keeps a conversation strictly ordered.
    const inboundDlq = new Queue(this, 'InboundDlq', { fifo: true, retentionPeriod: Duration.days(4) });
    const inbound = new Queue(this, 'Inbound', {
      fifo: true,
      // Lets the scheduler enqueue without an explicit dedup id; ingress still sets its own.
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.seconds(6 * 120),
      deadLetterQueue: { queue: inboundDlq, maxReceiveCount: 2 },
    });
    const outbound = new Queue(this, 'Outbound', { fifo: true, visibilityTimeout: Duration.seconds(60) });

    const bridgeSecret = StringParameter.fromSecureStringParameterAttributes(this, 'BridgeSecret', {
      parameterName: BRIDGE_SECRET_PARAM,
    });

    const ingress = fn('Ingress', 'ingress.ts', 10);
    ingress.addEnvironment('INBOUND_QUEUE_URL', inbound.queueUrl);
    ingress.addEnvironment('BRIDGE_SECRET_PARAM', BRIDGE_SECRET_PARAM);
    inbound.grantSendMessages(ingress);
    bridgeSecret.grantRead(ingress);

    const agent = fn('Agent', 'agent.ts', 120);
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

    new CfnOutput(this, 'IngressUrl', { value: `${api.apiEndpoint}/inbound` });
    new CfnOutput(this, 'OutboundQueueUrl', { value: outbound.queueUrl });
  }
}
