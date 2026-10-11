import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { isAllowlisted, OutboundMessage, type Logger } from '@app/core';
import type { Config } from './config.js';
import { directChatGuid, type BlueBubbles } from './bluebubbles.js';

// Long-polls the outbound queue so the Mac never needs an inbound tunnel from AWS.
export function startOutboundPoller(cfg: Config, bb: BlueBubbles, log: Logger) {
  const sqs = new SQSClient({ region: cfg.AWS_REGION });
  const queueUrl = cfg.OUTBOUND_QUEUE_URL;
  log.info('outbound poller started');

  const loop = async () => {
    for (;;) {
      try {
        const res = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 }),
        );
        // FIFO order: send one at a time so multi-part replies arrive in order.
        for (const m of res.Messages ?? []) {
          await handle(m.Body ?? '');
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
        }
      } catch (err) {
        log.error('outbound poll failed', { err });
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  };

  async function handle(body: string) {
    const parsed = OutboundMessage.safeParse(JSON.parse(body));
    if (!parsed.success) return log.error('bad outbound message, dropping', { issues: parsed.error.issues });
    const msg = parsed.data;
    // Second line of defense: even a buggy agent can't text anyone but a coordinator.
    if (!isAllowlisted(msg.to, cfg.allowlist)) return log.error('outbound to non-allowlisted number blocked');
    if (msg.text) await bb.sendText(directChatGuid(msg.to), msg.text);
    if (msg.attachment) log.warn('attachments not supported yet (M4)');
    log.info('outbound sent', { len: msg.text?.length ?? 0 });
  }

  void loop();
}
