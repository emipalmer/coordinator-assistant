import { App } from 'aws-cdk-lib';
import { CoordinatorStack } from '../lib/stack.js';

const app = new App();
const allowlist = process.env.COORDINATOR_ALLOWLIST;
if (!allowlist) throw new Error('COORDINATOR_ALLOWLIST must be set (see .env.example)');

new CoordinatorStack(app, 'CoordinatorAssistant', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  allowlist,
  llmProvider: process.env.LLM_PROVIDER ?? 'bedrock',
});
