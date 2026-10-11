import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { fileURLToPath } from 'node:url';

const lambdaSrc = (file: string) => fileURLToPath(new URL(`../../services/lambda/src/handlers/${file}`, import.meta.url));

export const BRIDGE_SECRET_PARAM = '/coord/bridge-secret';

export class CoordinatorStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { allowlist: string }) {
    super(scope, id, props);

    const fn = (name: string, file: string, timeout: number) =>
      new NodejsFunction(this, name, {
        entry: lambdaSrc(file),
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 512,
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
    agent.addEventSource(new SqsEventSource(inbound, { batchSize: 1 }));
    outbound.grantSendMessages(agent);

    const api = new HttpApi(this, 'Api');
    api.addRoutes({ path: '/inbound', methods: [HttpMethod.POST], integration: new HttpLambdaIntegration('IngressInt', ingress) });

    new CfnOutput(this, 'IngressUrl', { value: `${api.apiEndpoint}/inbound` });
    new CfnOutput(this, 'OutboundQueueUrl', { value: outbound.queueUrl });
  }
}
