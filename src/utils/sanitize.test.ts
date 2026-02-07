import { describe, it, expect } from 'vitest';
import { ObjectId } from 'mongodb';
import { convertObjectIdsToExtendedJson, sanitizeResponse } from './sanitize.js';

describe('convertObjectIdsToExtendedJson', () => {
  it('converts ObjectId to { $oid } format', () => {
    const id = new ObjectId();
    const result = convertObjectIdsToExtendedJson(id);
    expect(result).toEqual({ $oid: id.toHexString() });
  });

  it('converts ObjectIds in arrays', () => {
    const id = new ObjectId();
    const result = convertObjectIdsToExtendedJson([id, 'text']);
    expect(result).toEqual([{ $oid: id.toHexString() }, 'text']);
  });

  it('converts ObjectIds in nested objects', () => {
    const id = new ObjectId();
    const result = convertObjectIdsToExtendedJson({ doc: { _id: id } });
    expect(result).toEqual({ doc: { _id: { $oid: id.toHexString() } } });
  });

  it('leaves primitives unchanged', () => {
    expect(convertObjectIdsToExtendedJson('hello')).toBe('hello');
    expect(convertObjectIdsToExtendedJson(42)).toBe(42);
    expect(convertObjectIdsToExtendedJson(null)).toBeNull();
    expect(convertObjectIdsToExtendedJson(undefined)).toBeUndefined();
    expect(convertObjectIdsToExtendedJson(true)).toBe(true);
  });

  it('skips objects with custom prototypes (Date, etc.)', () => {
    const date = new Date('2024-01-01');
    const result = convertObjectIdsToExtendedJson(date);
    expect(result).toBe(date);
  });
});

describe('sanitizeResponse', () => {
  it('redacts sensitive fields', () => {
    const data = {
      name: 'test',
      password: 'secret123',
      apikey: 'key123',
      secretValue: 'hidden',
      tokenData: 'bearer xxx',
      connectionString: 'mongodb://user:pass@localhost:27017/mydb',
    };
    const result = sanitizeResponse(data);
    expect(result.name).toBe('test');
    expect(result.password).toBe('[REDACTED]');
    expect(result.secretValue).toBe('[REDACTED]');
    expect(result.tokenData).toBe('[REDACTED]');
    expect((result as any).connectionString).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields', () => {
    const data = {
      config: {
        password: 'secret',
        host: 'localhost',
      },
    };
    const result = sanitizeResponse(data);
    expect(result.config.password).toBe('[REDACTED]');
    expect(result.config.host).toBe('localhost');
  });

  it('converts ObjectIds in response', () => {
    const id = new ObjectId();
    const data = { _id: id, name: 'test' };
    const result = sanitizeResponse(data);
    expect((result as any)._id).toEqual({ $oid: id.toHexString() });
  });

  it('returns primitives unchanged', () => {
    expect(sanitizeResponse(null)).toBeNull();
    expect(sanitizeResponse('text')).toBe('text');
    expect(sanitizeResponse(42)).toBe(42);
  });
});
