import { describe, expect, it } from 'vitest';
import { isAllowlisted, normalizePhone, parseAllowlist } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['+16105550100', '+16105550100'],
    ['(610) 555-0100', '+16105550100'],
    ['1 610 555 0100', '+16105550100'],
    ['someone@icloud.com', null],
    ['12345', null],
  ])('%s -> %s', (raw, want) => expect(normalizePhone(raw)).toBe(want));
});

describe('allowlist', () => {
  const list = parseAllowlist('+16105550100, junk ,');
  it('accepts formatted variants of an allowlisted number', () => {
    expect(isAllowlisted('610-555-0100', list)).toBe(true);
  });
  it('rejects other numbers and emails', () => {
    expect(isAllowlisted('+13025550100', list)).toBe(false);
    expect(isAllowlisted('the bot Apple ID', list)).toBe(false);
  });
});
