import { getSecret } from './secrets.js';
import { createToolLoop, type ToolLoop } from './llm.js';
import { requireEnv } from './env.js';

export const MONGODB_URI_PARAM = '/coord/mongodb-uri';
export const ANTHROPIC_KEY_PARAM = '/coord/anthropic-api-key';

// Bedrock is the target; the Anthropic API is a stopgap while the new AWS account is being verified.
export async function loadToolLoop(): Promise<ToolLoop> {
  const provider = process.env.LLM_PROVIDER ?? 'bedrock';
  if (provider === 'anthropic') {
    return createToolLoop('anthropic', { model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5', anthropicKey: await getSecret(ANTHROPIC_KEY_PARAM) });
  }
  return createToolLoop('bedrock', { model: process.env.BEDROCK_MODEL ?? 'us.anthropic.claude-sonnet-5-5' });
}

export const mongoUri = () => (process.env.MONGODB_URI ? Promise.resolve(process.env.MONGODB_URI) : getSecret(MONGODB_URI_PARAM));
export const outboundQueueUrl = () => requireEnv('OUTBOUND_QUEUE_URL');
