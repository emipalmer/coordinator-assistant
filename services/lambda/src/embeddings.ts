import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '@app/core';

const client = new BedrockRuntimeClient({});
export const EMBEDDING_DIMS = 1024;
const MODEL_ID = 'amazon.titan-embed-text-v2:0';

/** Best-effort: returns null if Bedrock is unavailable so writes never fail on embeddings. */
export async function embed(text: string, log: Logger): Promise<number[] | null> {
  if (!text.trim()) return null;
  try {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ inputText: text.slice(0, 8000), dimensions: EMBEDDING_DIMS, normalize: true }),
      }),
    );
    return (JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] }).embedding;
  } catch (err) {
    log.warn('embedding unavailable', { err: (err as Error).message });
    return null;
  }
}
