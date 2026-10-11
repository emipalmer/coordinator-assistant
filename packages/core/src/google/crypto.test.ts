import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

const key = 'a'.repeat(64);
describe('token encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const sealed = encryptSecret(key, '1//refresh-token-value');
    expect(sealed).not.toContain('refresh-token');
    expect(decryptSecret(key, sealed)).toBe('1//refresh-token-value');
  });
  it('fails on tampering or the wrong key', () => {
    const sealed = encryptSecret(key, 'x');
    expect(() => decryptSecret('b'.repeat(64), sealed)).toThrow();
    expect(() => decryptSecret(key, `${sealed.slice(0, -2)}AA`)).toThrow();
  });
});
