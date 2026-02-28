import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MAX_QUERY_LIMIT, MAX_EXPORT_LIMIT, MAX_SAMPLE_SIZE } from './query-limits.js';

describe('query limits constants', () => {
  it('MAX_QUERY_LIMIT is 10000', () => {
    expect(MAX_QUERY_LIMIT).toBe(10_000);
  });

  it('MAX_EXPORT_LIMIT is 50000', () => {
    expect(MAX_EXPORT_LIMIT).toBe(50_000);
  });

  it('MAX_SAMPLE_SIZE is 10000', () => {
    expect(MAX_SAMPLE_SIZE).toBe(10_000);
  });

  it('zod schema with .max(MAX_QUERY_LIMIT) rejects values above limit', () => {
    const schema = z.number().positive().max(MAX_QUERY_LIMIT).optional();
    expect(schema.safeParse(10_001).success).toBe(false);
    expect(schema.safeParse(10_000).success).toBe(true);
    expect(schema.safeParse(1).success).toBe(true);
  });

  it('zod schema with .max(MAX_EXPORT_LIMIT) rejects values above limit', () => {
    const schema = z.number().positive().max(MAX_EXPORT_LIMIT).optional();
    expect(schema.safeParse(50_001).success).toBe(false);
    expect(schema.safeParse(50_000).success).toBe(true);
  });

  it('zod schema with .max(MAX_SAMPLE_SIZE) rejects values above limit', () => {
    const schema = z.number().positive().max(MAX_SAMPLE_SIZE).optional();
    expect(schema.safeParse(10_001).success).toBe(false);
    expect(schema.safeParse(10_000).success).toBe(true);
  });
});
