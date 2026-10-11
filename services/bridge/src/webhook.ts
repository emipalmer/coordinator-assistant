import { z } from 'zod';
import { normalizePhone, type InboundMessage } from '@app/core';

// Only the fields we use from a BlueBubbles message object; everything else passes through untouched.
const BbMessage = z.object({
  guid: z.string(),
  text: z.string().nullable().optional(),
  isFromMe: z.boolean(),
  dateCreated: z.number().optional(),
  handle: z.object({ address: z.string() }).nullable().optional(),
  chats: z.array(z.object({ guid: z.string() })).optional(),
  attachments: z
    .array(z.object({ guid: z.string(), mimeType: z.string().nullable().optional(), transferName: z.string().nullable().optional() }))
    .optional(),
});
const BbEvent = z.object({ type: z.string(), data: z.unknown() });

export type ParseResult = { ok: true; message: InboundMessage } | { ok: false; reason: string };

/** Turn a raw webhook body into an InboundMessage, or explain why it should be ignored. */
export function parseWebhook(body: unknown): ParseResult {
  const evt = BbEvent.safeParse(body);
  if (!evt.success) return { ok: false, reason: 'not a BlueBubbles event' };
  if (evt.data.type !== 'new-message') return { ok: false, reason: `ignored event ${evt.data.type}` };

  const msg = BbMessage.safeParse(evt.data.data);
  if (!msg.success) return { ok: false, reason: 'unrecognized message shape' };
  const m = msg.data;
  // Our own outbound sends also arrive as new-message events; dropping them prevents reply loops.
  if (m.isFromMe) return { ok: false, reason: 'from me' };

  const from = m.handle?.address ? normalizePhone(m.handle.address) : null;
  if (!from) return { ok: false, reason: 'sender is not a phone number' };
  const chatGuid = m.chats?.[0]?.guid;
  if (!chatGuid) return { ok: false, reason: 'no chat' };
  // Group chats contain ';+;' — the assistant only works 1:1 with a coordinator.
  if (chatGuid.includes(';+;')) return { ok: false, reason: 'group chat' };

  return {
    ok: true,
    message: {
      messageId: m.guid,
      from,
      chatGuid,
      text: m.text ?? '',
      attachments: m.attachments ?? [],
      receivedAt: new Date(m.dateCreated ?? Date.now()).toISOString(),
    },
  };
}
