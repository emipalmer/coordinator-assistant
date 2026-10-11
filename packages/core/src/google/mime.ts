// RFC 2822 / MIME builder for Gmail drafts. Pure so it can be tested without Google.

export interface MailAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface MailDraft {
  to?: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

// Header values with non-ASCII (names, emoji) must be RFC 2047 encoded.
export function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, (l) => `${l}\r\n`).trimEnd();
const safeFilename = (s: string) => s.replace(/["\\\r\n]/g, '_');
const isEmail = (s: string) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s);

export function buildMime(d: MailDraft, boundary = `tari_${Math.random().toString(36).slice(2)}`): string {
  const to = (d.to ?? []).filter(isEmail);
  const headers = [
    ...(to.length ? [`To: ${to.join(', ')}`] : []),
    `Subject: ${encodeHeader(d.subject.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0',
  ];
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(d.text, 'utf8').toString('base64'))];
  if (!d.attachments?.length) return [...headers, ...textPart].join('\r\n');

  const parts = [
    [`--${boundary}`, ...textPart].join('\r\n'),
    ...d.attachments.map((a) =>
      [
        `--${boundary}`,
        `Content-Type: ${a.contentType}; name="${safeFilename(a.filename)}"`,
        `Content-Disposition: attachment; filename="${safeFilename(a.filename)}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(Buffer.from(a.bytes).toString('base64')),
      ].join('\r\n'),
    ),
  ];
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts, `--${boundary}--`, ''].join('\r\n');
}

/** Gmail's `message.raw` is base64url of the full RFC 2822 message. */
export const toGmailRaw = (mime: string) => Buffer.from(mime, 'utf8').toString('base64url');
