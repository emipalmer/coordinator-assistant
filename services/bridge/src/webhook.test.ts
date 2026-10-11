import { describe, expect, it } from 'vitest';
import { parseWebhook } from './webhook.js';

const base = {
  guid: 'ABC',
  text: 'Add Sam',
  isFromMe: false,
  dateCreated: 1791746159357,
  handle: { address: '+16105550100' },
  chats: [{ guid: 'iMessage;-;+16105550100' }],
  attachments: [],
};

describe('parseWebhook', () => {
  it('parses a 1:1 new message', () => {
    const r = parseWebhook({ type: 'new-message', data: base });
    expect(r).toMatchObject({ ok: true, message: { messageId: 'ABC', from: '+16105550100', text: 'Add Sam' } });
  });
  it('drops our own sends, other events, and group chats', () => {
    expect(parseWebhook({ type: 'new-message', data: { ...base, isFromMe: true } }).ok).toBe(false);
    expect(parseWebhook({ type: 'updated-message', data: base }).ok).toBe(false);
    expect(parseWebhook({ type: 'new-message', data: { ...base, chats: [{ guid: 'iMessage;+;chat123' }] } }).ok).toBe(false);
  });
  it('treats a null text (attachment-only message) as empty string', () => {
    const r = parseWebhook({ type: 'new-message', data: { ...base, text: null } });
    expect(r.ok && r.message.text).toBe('');
  });
});
