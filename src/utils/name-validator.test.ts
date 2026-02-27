import { describe, it, expect } from 'vitest';
import { validateCollectionName } from './name-validator.js';

describe('validateCollectionName', () => {
  describe('valid names', () => {
    it('accepts normal collection names', () => {
      expect(validateCollectionName('users')).toEqual({ valid: true });
    });

    it('accepts names with dots (non-system)', () => {
      expect(validateCollectionName('app.logs')).toEqual({ valid: true });
    });

    it('accepts names that contain "system" but do not start with "system."', () => {
      expect(validateCollectionName('my_system_data')).toEqual({ valid: true });
    });

    it('accepts "system" without trailing dot', () => {
      expect(validateCollectionName('system')).toEqual({ valid: true });
    });
  });

  describe('system collection blocking', () => {
    it('rejects system.profile', () => {
      const result = validateCollectionName('system.profile');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/system\./i);
    });

    it('rejects system.users', () => {
      const result = validateCollectionName('system.users');
      expect(result.valid).toBe(false);
    });

    it('rejects system.js', () => {
      const result = validateCollectionName('system.js');
      expect(result.valid).toBe(false);
    });

    it('rejects system.views', () => {
      const result = validateCollectionName('system.views');
      expect(result.valid).toBe(false);
    });

    it('rejects system.buckets.any', () => {
      const result = validateCollectionName('system.buckets.any');
      expect(result.valid).toBe(false);
    });
  });

  describe('invalid inputs', () => {
    it('rejects empty string', () => {
      const result = validateCollectionName('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty/i);
    });

    it('rejects names containing null bytes', () => {
      const result = validateCollectionName('users\0evil');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/null/i);
    });
  });
});
