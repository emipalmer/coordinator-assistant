import { PARAMS } from '@app/core';
import { getSecret } from './secrets.js';
import { createToolLoop, type ToolLoop } from './llm.js';
import { requireEnv } from './env.js';

// Bedrock is supported; the Anthropic API is the default provider for this deployment (LLM_PROVIDER).
export async function loadToolLoop(): Promise<ToolLoop> {
  const provider = process.env.LLM_PROVIDER ?? 'anthropic';
  if (provider === 'anthropic') {
    return createToolLoop('anthropic', { model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5', anthropicKey: await getSecret(PARAMS.anthropicKey) });
  }
  return createToolLoop('bedrock', { model: process.env.BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-5-5' });
}

export const mongoUri = () => (process.env.MONGODB_URI ? Promise.resolve(process.env.MONGODB_URI) : getSecret(PARAMS.mongoUri));
export const outboundQueueUrl = () => requireEnv('OUTBOUND_QUEUE_URL');
