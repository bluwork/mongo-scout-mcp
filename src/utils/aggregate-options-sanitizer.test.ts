import { describe, it, expect } from 'vitest';
import { sanitizeAggregateOptions } from './aggregate-options-sanitizer.js';

describe('sanitizeAggregateOptions', () => {
  describe('strips write-enabling options', () => {
    it('strips out (legacy $out bypass)', () => {
      const result = sanitizeAggregateOptions({ out: 'pwned' });
      expect(result).not.toHaveProperty('out');
    });

    it('strips out with object format', () => {
      const result = sanitizeAggregateOptions({ out: { db: 'admin', coll: 'x' } });
      expect(result).not.toHaveProperty('out');
    });

    it('strips writeConcern', () => {
      const result = sanitizeAggregateOptions({ writeConcern: { w: 1 } });
      expect(result).not.toHaveProperty('writeConcern');
    });

    it('strips bypassDocumentValidation', () => {
      const result = sanitizeAggregateOptions({ bypassDocumentValidation: true });
      expect(result).not.toHaveProperty('bypassDocumentValidation');
    });
  });

  describe('passes through safe options', () => {
    it('passes maxTimeMS', () => {
      const result = sanitizeAggregateOptions({ maxTimeMS: 5000 });
      expect(result).toEqual({ maxTimeMS: 5000 });
    });

    it('passes allowDiskUse', () => {
      const result = sanitizeAggregateOptions({ allowDiskUse: true });
      expect(result).toEqual({ allowDiskUse: true });
    });

    it('passes comment', () => {
      const result = sanitizeAggregateOptions({ comment: 'test query' });
      expect(result).toEqual({ comment: 'test query' });
    });

    it('passes hint', () => {
      const result = sanitizeAggregateOptions({ hint: { _id: 1 } });
      expect(result).toEqual({ hint: { _id: 1 } });
    });

    it('passes collation', () => {
      const collation = { locale: 'en', strength: 2 };
      const result = sanitizeAggregateOptions({ collation });
      expect(result).toEqual({ collation });
    });

    it('passes let variables', () => {
      const letVars = { threshold: 100 };
      const result = sanitizeAggregateOptions({ let: letVars });
      expect(result).toEqual({ let: letVars });
    });

    it('passes batchSize', () => {
      const result = sanitizeAggregateOptions({ batchSize: 100 });
      expect(result).toEqual({ batchSize: 100 });
    });

    it('passes cursor', () => {
      const result = sanitizeAggregateOptions({ cursor: { batchSize: 50 } });
      expect(result).toEqual({ cursor: { batchSize: 50 } });
    });

    it('passes readConcern', () => {
      const result = sanitizeAggregateOptions({ readConcern: { level: 'majority' } });
      expect(result).toEqual({ readConcern: { level: 'majority' } });
    });

    it('passes readPreference', () => {
      const result = sanitizeAggregateOptions({ readPreference: 'secondaryPreferred' });
      expect(result).toEqual({ readPreference: 'secondaryPreferred' });
    });
  });

  describe('mixed options — keeps safe, strips dangerous', () => {
    it('strips out while keeping maxTimeMS and allowDiskUse', () => {
      const result = sanitizeAggregateOptions({
        maxTimeMS: 5000,
        allowDiskUse: true,
        out: 'pwned',
      });
      expect(result).toEqual({ maxTimeMS: 5000, allowDiskUse: true });
    });

    it('strips multiple dangerous keys at once', () => {
      const result = sanitizeAggregateOptions({
        comment: 'legit',
        out: 'evil',
        writeConcern: { w: 1 },
        bypassDocumentValidation: true,
      });
      expect(result).toEqual({ comment: 'legit' });
    });
  });

  describe('strips unknown/unexpected options', () => {
    it('strips arbitrary unknown keys', () => {
      const result = sanitizeAggregateOptions({ foo: 'bar', baz: 123 });
      expect(result).toEqual({});
    });

    it('strips session (internal driver option)', () => {
      const result = sanitizeAggregateOptions({ session: { id: 'x' } });
      expect(result).not.toHaveProperty('session');
    });
  });

  describe('edge cases', () => {
    it('returns empty object for empty input', () => {
      const result = sanitizeAggregateOptions({});
      expect(result).toEqual({});
    });

    it('handles case variations — only exact lowercase matches', () => {
      const result = sanitizeAggregateOptions({ Out: 'pwned', OUT: 'pwned', maxTimeMS: 1000 });
      expect(result).toEqual({ maxTimeMS: 1000 });
    });
  });
});
