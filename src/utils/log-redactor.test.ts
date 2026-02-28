import { describe, it, expect } from 'vitest';
import { redactSensitiveKeys } from './log-redactor.js';

/**
 * Fix 6: Logging redaction must cover sensitive payload keys, not just URIs.
 */
describe('redactSensitiveKeys', () => {
  it('redacts password fields', () => {
    const input = { username: 'alice', password: 'FAKE_TEST_VALUE' };
    const result = redactSensitiveKeys(input);
    expect(result.username).toBe('alice');
    expect(result.password).toBe('[REDACTED]');
  });

  it('redacts token fields', () => {
    const input = { apiToken: 'tok_abc123', name: 'test' };
    const result = redactSensitiveKeys(input);
    expect(result.apiToken).toBe('[REDACTED]');
    expect(result.name).toBe('test');
  });

  it('redacts secret fields', () => {
    const input = { clientSecret: 'shh', id: 1 };
    const result = redactSensitiveKeys(input);
    expect(result.clientSecret).toBe('[REDACTED]');
    expect(result.id).toBe(1);
  });

  it('redacts key fields', () => {
    const input = { apiKey: 'sk-12345', collection: 'users' };
    const result = redactSensitiveKeys(input);
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.collection).toBe('users');
  });

  it('redacts connectionString fields', () => {
    const input = { connectionString: 'mongodb://user:pass@host/db' };
    const result = redactSensitiveKeys(input);
    expect(result.connectionString).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields', () => {
    const input = {
      document: {
        name: 'alice',
        credentials: { password: 'secret', token: 'tok_123' },
      },
    };
    const result = redactSensitiveKeys(input);
    expect(result.document.name).toBe('alice');
    expect(result.document.credentials.password).toBe('[REDACTED]');
    expect(result.document.credentials.token).toBe('[REDACTED]');
  });

  it('is case-insensitive for field names', () => {
    const input = { PASSWORD: 'secret', ApiKey: 'key123' };
    const result = redactSensitiveKeys(input);
    expect(result.PASSWORD).toBe('[REDACTED]');
    expect(result.ApiKey).toBe('[REDACTED]');
  });

  it('handles null and undefined values', () => {
    expect(redactSensitiveKeys(null)).toBeNull();
    expect(redactSensitiveKeys(undefined)).toBeUndefined();
  });

  it('handles primitive values', () => {
    expect(redactSensitiveKeys('string')).toBe('string');
    expect(redactSensitiveKeys(42)).toBe(42);
  });

  it('handles arrays with sensitive objects', () => {
    const input = [{ password: 'secret' }, { name: 'test' }];
    const result = redactSensitiveKeys(input);
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].name).toBe('test');
  });

  it('does not redact fields that merely contain sensitive-sounding values', () => {
    const input = { description: 'Enter your password here', role: 'admin' };
    const result = redactSensitiveKeys(input);
    expect(result.description).toBe('Enter your password here');
    expect(result.role).toBe('admin');
  });

  it('preserves Date instances instead of destroying them', () => {
    const date = new Date('2026-01-01');
    const input = { createdAt: date, name: 'test' };
    const result = redactSensitiveKeys(input);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt).toEqual(date);
    expect(result.name).toBe('test');
  });

  it('preserves non-plain objects (class instances) as-is', () => {
    class Custom { constructor(public value: number) {} }
    const instance = new Custom(42);
    const input = { data: instance, name: 'test' };
    const result = redactSensitiveKeys(input);
    expect(result.data).toBeInstanceOf(Custom);
    expect(result.data.value).toBe(42);
  });
});
