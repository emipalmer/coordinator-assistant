import { describe, expect, it } from 'vitest';
import { splitReply } from './reply.js';

describe('splitReply', () => {
  it('puts each draft in its own bubble after the main text', () => {
    const r = splitReply('Sam turns 20 Thursday. Here is a draft:\n[[draft]]Happy birthday Sam! 🎉[[/draft]]\nWant a reminder?');
    expect(r).toEqual(['Sam turns 20 Thursday. Here is a draft:\n\nWant a reminder?', 'Happy birthday Sam! 🎉']);
  });
  it('passes plain replies through', () => {
    expect(splitReply('Logged 7 hours.')).toEqual(['Logged 7 hours.']);
  });
  it('handles a reply that is only a draft', () => {
    expect(splitReply('[[draft]]Hi Maria![[/draft]]')).toEqual(['Hi Maria!']);
  });
});
