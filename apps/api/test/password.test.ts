import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password hashing', () => {
  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password entirely', hash)).toBe(false);
  });

  it('salts independently, so the same password hashes differently each time', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password', a)).toBe(true);
    expect(await verifyPassword('same password', b)).toBe(true);
  });

  it('rejects a tampered hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    const tampered = hash.slice(0, -4) + '0000';
    expect(await verifyPassword('correct horse battery staple', tampered)).toBe(false);
  });

  it('rejects garbage input rather than throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-real-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});
