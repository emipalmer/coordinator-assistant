import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { OutboundMessage } from '@app/core';
import { randomUUID } from 'node:crypto';

const sqs = new SQSClient({});

/** Queue replies to a coordinator. One FIFO group per coordinator keeps multi-part replies in order. */
export async function sendToCoordinator(queueUrl: string, messages: OutboundMessage[]) {
  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10).map((m) => OutboundMessage.parse(m));
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: chunk.map((m, j) => ({
          Id: String(j),
          MessageBody: JSON.stringify(m),
          MessageGroupId: m.to,
          MessageDeduplicationId: randomUUID(),
        })),
      }),
    );
  }
}
