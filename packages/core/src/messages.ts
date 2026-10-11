import { z } from 'zod';

export const Attachment = z.object({
  guid: z.string(),
  mimeType: z.string().nullable().optional(),
  transferName: z.string().nullable().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

/** What the bridge forwards to AWS for each coordinator message. */
export const InboundMessage = z.object({
  messageId: z.string(),
  from: z.string(), // E.164
  chatGuid: z.string(),
  text: z.string(),
  attachments: z.array(Attachment).default([]),
  receivedAt: z.string(),
});
export type InboundMessage = z.infer<typeof InboundMessage>;

/** What the agent puts on the outbound queue; the bridge turns each into one iMessage. */
export const OutboundMessage = z.object({
  to: z.string(), // E.164, re-checked against the allowlist by the bridge
  text: z.string().optional(),
  // S3 presigned URL; the bridge downloads it and sends it as a file
  attachment: z.object({ url: z.string().url(), filename: z.string() }).optional(),
}).refine((m) => m.text || m.attachment, 'text or attachment required');
export type OutboundMessage = z.infer<typeof OutboundMessage>;
