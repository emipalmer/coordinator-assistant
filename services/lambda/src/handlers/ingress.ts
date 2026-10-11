import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createLogger, InboundMessage, isAllowlisted, parseAllowlist, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from '@app/core';
import { getSecret } from '../secrets.js';
import { requireEnv } from '../env.js';

const log = createLogger({ svc: 'ingress' });
const sqs = new SQSClient({});
const allowlist = parseAllowlist(process.env.COORDINATOR_ALLOWLIST);

// Fast path only: verify, validate, enqueue. The agent loop can outlast API Gateway's 29s limit, so it runs off the queue.
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : (event.body ?? '');
  const secret = await getSecret(requireEnv('BRIDGE_SECRET_PARAM'));
  if (!verify(secret, event.headers[TIMESTAMP_HEADER], event.headers[SIGNATURE_HEADER], body)) {
    log.warn('bad signature');
    return { statusCode: 401 };
  }

  let parsed;
  try {
    parsed = InboundMessage.safeParse(JSON.parse(body));
  } catch {
    return { statusCode: 400 };
  }
  if (!parsed.success) return { statusCode: 400, body: 'invalid message' };
  const msg = parsed.data;
  if (!isAllowlisted(msg.from, allowlist)) {
    log.warn('non-allowlisted sender rejected');
    return { statusCode: 403 };
  }

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: requireEnv('INBOUND_QUEUE_URL'),
      MessageBody: JSON.stringify(msg),
      MessageGroupId: msg.from,
      // iMessage guid doubles as the FIFO dedup id, so a re-delivered webhook is dropped by SQS.
      MessageDeduplicationId: msg.messageId,
    }),
  );
  log.info('enqueued', { messageId: msg.messageId });
  return { statusCode: 202 };
}
