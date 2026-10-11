import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { AgentEvent, createLogger, InboundMessage, isAllowlisted, parseAllowlist, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from '@app/core';
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

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { statusCode: 400 };
  }
  if (event.rawPath.endsWith('/events')) return enqueueEvent(json);
  const parsed = InboundMessage.safeParse(json);
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

// Database-change events from the bridge. They share the main coordinator's FIFO group so an
// alert never runs concurrently with a coordinator turn and races the conversation history.
async function enqueueEvent(json: unknown): Promise<APIGatewayProxyResultV2> {
  const parsed = AgentEvent.safeParse(json);
  if (!parsed.success) return { statusCode: 400, body: 'invalid event' };
  const group = [...allowlist][0];
  if (!group) return { statusCode: 500 };
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: requireEnv('INBOUND_QUEUE_URL'),
      MessageBody: JSON.stringify(parsed.data),
      MessageGroupId: group,
      MessageDeduplicationId: parsed.data.eventId,
    }),
  );
  log.info('event enqueued', { type: parsed.data.type, eventId: parsed.data.eventId });
  return { statusCode: 202 };
}
