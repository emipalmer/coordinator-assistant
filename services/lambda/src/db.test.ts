import { describe, expect, it } from 'vitest';
import { collapseTurns } from './db.js';

describe('collapseTurns', () => {
  it('merges back-to-back turns from the same side so roles alternate', () => {
    const t = collapseTurns([
      { role: 'user' as const, text: 'connect google' },
      { role: 'assistant' as const, text: 'Here is your link' },
      { role: 'assistant' as const, text: 'Connected. Add shifts?\nA. Yes\nB. Not now' },
      { role: 'user' as const, text: 'A' },
    ]);
    expect(t.map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    expect(t[1]!.text).toContain('A. Yes');
  });
});
