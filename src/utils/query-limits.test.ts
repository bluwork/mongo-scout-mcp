import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { MAX_QUERY_LIMIT, MAX_EXPORT_LIMIT, MAX_SAMPLE_SIZE, capResultSize, MAX_RESULT_SIZE_BYTES } from './query-limits.js';

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

describe('capResultSize', () => {
  it('returns result unchanged when under size limit', () => {
    const data = [{ name: 'test' }];
    const { result, truncated } = capResultSize(data);
    expect(result).toEqual(data);
    expect(truncated).toBe(false);
  });

  it('truncates result array when over size limit', () => {
    const bigItem = { data: 'x'.repeat(200_000) };
    const data = Array.from({ length: 10 }, () => ({ ...bigItem }));
    const { result, truncated, warning } = capResultSize(data);
    expect(truncated).toBe(true);
    expect(result.length).toBeLessThan(data.length);
    expect(warning).toContain('size limit');
  });

  it('returns at least one item even if single item exceeds limit', () => {
    const data = [{ data: 'x'.repeat(2_000_000) }];
    const { result, truncated } = capResultSize(data);
    expect(result.length).toBe(1);
    expect(truncated).toBe(true);
  });

  it('exports MAX_RESULT_SIZE_BYTES', () => {
    expect(MAX_RESULT_SIZE_BYTES).toBe(1_048_576);
  });

  it('measures size in bytes, not string length (multibyte chars)', () => {
    // Each emoji is 4 bytes in UTF-8 but 2 code units in JS strings
    const emoji = '\u{1F600}'; // 😀
    const item = { data: emoji.repeat(300_000) }; // ~1.2MB in bytes, ~600K in .length
    const data = [item];
    const { truncated } = capResultSize(data);
    // With byte counting, this exceeds 1MB; with .length it wouldn't
    expect(truncated).toBe(true);
  });
});
