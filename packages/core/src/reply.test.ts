import { describe, expect, it } from 'vitest';
import { splitReply } from './reply.js';

describe('splitReply', () => {
  it('keeps each draft right after the text that introduces it', () => {
    const r = splitReply('Check-ins:\nPriya, 48 days:\n[[draft]]Hi Priya![[/draft]]\n\nAlex, 61 days:\n[[draft]]Hi Alex![[/draft]]\nThat is all.');
    expect(r).toEqual(['Check-ins:\nPriya, 48 days:', 'Hi Priya!', 'Alex, 61 days:', 'Hi Alex!', 'That is all.']);
  });
  it('passes plain replies through', () => {
    expect(splitReply('Logged 7 hours.')).toEqual(['Logged 7 hours.']);
  });
  it('handles a reply that is only a draft', () => {
    expect(splitReply('[[draft]]Hi Maria![[/draft]]')).toEqual(['Hi Maria!']);
  });
});
