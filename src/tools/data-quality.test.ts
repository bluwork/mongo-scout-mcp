import { describe, it, expect } from 'vitest';
import { validateCollectionName } from '../utils/name-validator.js';

describe('exploreRelationships foreignCollection validation', () => {
  it('rejects system collections in foreignCollection', () => {
    const result = validateCollectionName('system.profile');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/system\./i);
  });

  it('rejects null bytes in foreignCollection', () => {
    const result = validateCollectionName('users\0admin');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/null/i);
  });

  it('rejects empty foreignCollection', () => {
    const result = validateCollectionName('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('accepts valid foreignCollection names', () => {
    const result = validateCollectionName('orders');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
