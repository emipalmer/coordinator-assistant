import type { SQSEvent } from 'aws-lambda';
import { createLogger, InboundMessage } from '@app/core';
import { sendToCoordinator } from '../outbox.js';
import { requireEnv } from '../env.js';

const log = createLogger({ svc: 'agent' });

// M1: echo. M2 replaces the body with the Bedrock tool loop.
export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const msg = InboundMessage.parse(JSON.parse(record.body));
    log.info('agent received', { messageId: msg.messageId });
    await sendToCoordinator(requireEnv('OUTBOUND_QUEUE_URL'), [{ to: msg.from, text: `echo (aws): ${msg.text}` }]);
  }
}
