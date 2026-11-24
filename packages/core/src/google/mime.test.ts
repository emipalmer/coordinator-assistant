import { describe, expect, it } from 'vitest';
import { buildMime, encodeHeader, toGmailRaw } from './mime.js';

describe('buildMime', () => {
  it('builds a plain text draft with CRLF line endings', () => {
    const m = buildMime({ to: ['sam@example.org'], subject: 'Saturday pantry', text: 'See you at 9!' });
    expect(m).toContain('To: sam@example.org\r\n');
    expect(m).toContain('Subject: Saturday pantry\r\n');
    expect(Buffer.from(m.split('\r\n\r\n')[1]!, 'base64').toString()).toBe('See you at 9!');
  });
  it('drops invalid recipients and header injection attempts', () => {
    const m = buildMime({ to: ['not-an-email', 'a@b.org\r\nBcc: evil@x.com'], subject: 'Hi\r\nBcc: evil@x.com', text: 'x' });
    const lines = m.split('\r\n');
    expect(lines.some((l) => l.startsWith('Bcc:'))).toBe(false); // newline stripped, so no injected header
    expect(lines.some((l) => l.startsWith('To:'))).toBe(false);
  });
  it('encodes non-ASCII subjects', () => {
    expect(encodeHeader('Thank you, María 🎉')).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
  it('attaches files as multipart/mixed', () => {
    const m = buildMime({ subject: 's', text: 't', attachments: [{ filename: 'packet.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }] }, 'B');
    expect(m).toContain('Content-Type: multipart/mixed; boundary="B"');
    expect(m).toContain('Content-Disposition: attachment; filename="packet.pdf"');
    expect(m.trimEnd().endsWith('--B--')).toBe(true);
  });
  it('threads replies and strips newlines from message ids', () => {
    const m = buildMime({ to: ['a@b.org'], cc: ['c@d.org', 'bad'], subject: 'Re: x', text: 't', inReplyTo: '<id@mail>\r\nBcc: evil@x.com' });
    const lines = m.split('\r\n');
    expect(lines).toContain('Cc: c@d.org');
    expect(lines.find((l) => l.startsWith('In-Reply-To:'))).toBe('In-Reply-To: <id@mail> Bcc: evil@x.com');
    expect(lines.some((l) => l.startsWith('Bcc:'))).toBe(false);
  });
  it('produces base64url for the Gmail API', () => {
    expect(toGmailRaw('a?b>c')).not.toMatch(/[+/=]/);
  });
});
