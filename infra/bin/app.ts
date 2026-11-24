import { App } from 'aws-cdk-lib';
import { AssistantStack } from '../lib/stack.js';
import { STACK_NAME } from '../../packages/core/src/params.js';

const app = new App();
const allowlist = process.env.ALLOWLIST;
if (!allowlist) throw new Error('ALLOWLIST must be set (see .env.example)');

new AssistantStack(app, STACK_NAME, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  allowlist,
  llmProvider: process.env.LLM_PROVIDER ?? 'anthropic',
});
