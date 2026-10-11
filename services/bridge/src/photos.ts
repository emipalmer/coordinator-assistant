import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { InboundMessage, Logger } from '@app/core';
import type { BlueBubbles } from './bluebubbles.js';

let s3: S3Client | undefined;

/**
 * Copy image attachments from BlueBubbles into S3 so the agent (in AWS) can read them.
 * Photos go up as-is; nothing leaves the Mac except to our private bucket.
 */
export async function uploadImages(msg: InboundMessage, bb: BlueBubbles, bucket: string, region: string, log: Logger) {
  s3 ??= new S3Client({ region });
  const out = [];
  for (const a of msg.attachments) {
    if (!a.mimeType?.startsWith('image/')) {
      out.push(a);
      continue;
    }
    try {
      const { bytes, contentType } = await bb.downloadAttachment(a.guid);
      const key = `inbound/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${contentType.split('/')[1] ?? 'bin'}`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
      out.push({ ...a, s3Key: key, mimeType: contentType });
    } catch (err) {
      log.error('image upload failed', { err });
      out.push(a);
    }
  }
  return out;
}
