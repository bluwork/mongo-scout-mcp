import { describe, it, expect } from 'vitest';
import { validateBulkOperations, MAX_BULK_OPERATIONS, VALID_BULK_OPERATION_TYPES } from './bulk-write-validator.js';

describe('VALID_BULK_OPERATION_TYPES', () => {
  it('includes all standard MongoDB bulk operation types', () => {
    expect(VALID_BULK_OPERATION_TYPES).toContain('insertOne');
    expect(VALID_BULK_OPERATION_TYPES).toContain('updateOne');
    expect(VALID_BULK_OPERATION_TYPES).toContain('updateMany');
    expect(VALID_BULK_OPERATION_TYPES).toContain('deleteOne');
    expect(VALID_BULK_OPERATION_TYPES).toContain('deleteMany');
    expect(VALID_BULK_OPERATION_TYPES).toContain('replaceOne');
  });
});

describe('MAX_BULK_OPERATIONS', () => {
  it('has a reasonable default cap', () => {
    expect(MAX_BULK_OPERATIONS).toBe(1000);
  });
});

describe('validateBulkOperations', () => {
  describe('valid operations', () => {
    it('accepts a single insertOne', () => {
      const result = validateBulkOperations([
        { insertOne: { document: { name: 'test' } } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('accepts a single updateOne with non-empty filter', () => {
      const result = validateBulkOperations([
        { updateOne: { filter: { _id: '123' }, update: { $set: { name: 'x' } } } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('accepts a single deleteOne with non-empty filter', () => {
      const result = validateBulkOperations([
        { deleteOne: { filter: { _id: '123' } } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('accepts mixed valid operations', () => {
      const result = validateBulkOperations([
        { insertOne: { document: { name: 'test' } } },
        { updateOne: { filter: { _id: '1' }, update: { $set: { x: 1 } } } },
        { deleteOne: { filter: { _id: '2' } } },
        { replaceOne: { filter: { _id: '3' }, replacement: { name: 'new' } } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('accepts updateMany with non-empty filter', () => {
      const result = validateBulkOperations([
        { updateMany: { filter: { status: 'old' }, update: { $set: { status: 'new' } } } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('accepts deleteMany with non-empty filter', () => {
      const result = validateBulkOperations([
        { deleteMany: { filter: { status: 'deleted' } } },
      ]);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid operation types', () => {
    it('rejects unknown operation types', () => {
      const result = validateBulkOperations([
        { dropCollection: { name: 'test' } } as any,
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/dropCollection/i);
    });

    it('rejects empty operation object', () => {
      const result = validateBulkOperations([{}]);
      expect(result.valid).toBe(false);
    });

    it('rejects operation with multiple types in one object', () => {
      const result = validateBulkOperations([
        { insertOne: { document: { x: 1 } }, deleteOne: { filter: { x: 1 } } } as any,
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/multiple/i);
    });
  });

  describe('empty filter protection', () => {
    it('blocks updateMany with empty filter', () => {
      const result = validateBulkOperations([
        { updateMany: { filter: {}, update: { $set: { x: 1 } } } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty filter/i);
    });

    it('blocks deleteMany with empty filter', () => {
      const result = validateBulkOperations([
        { deleteMany: { filter: {} } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty filter/i);
    });

    it('does NOT block updateOne with empty filter (single-doc operations are safer)', () => {
      const result = validateBulkOperations([
        { updateOne: { filter: {}, update: { $set: { x: 1 } } } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('does NOT block deleteOne with empty filter', () => {
      const result = validateBulkOperations([
        { deleteOne: { filter: {} } },
      ]);
      expect(result.valid).toBe(true);
    });

    it('reports which operation index has the empty filter', () => {
      const result = validateBulkOperations([
        { insertOne: { document: { x: 1 } } },
        { deleteMany: { filter: {} } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/operation 2/i);
    });
  });

  describe('dangerous operator blocking', () => {
    it('blocks $where in updateOne filter', () => {
      const result = validateBulkOperations([
        { updateOne: { filter: { $where: 'true' }, update: { $set: { x: 1 } } } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/\$where/);
    });

    it('blocks $function in deleteMany filter', () => {
      const result = validateBulkOperations([
        { deleteMany: { filter: { $expr: { $function: { body: 'bad', args: [], lang: 'js' } } } } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/\$function/);
    });

    it('blocks $where in replaceOne filter', () => {
      const result = validateBulkOperations([
        { replaceOne: { filter: { $where: 'true' }, replacement: { x: 1 } } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/\$where/);
    });

    it('blocks dangerous operators in update document', () => {
      const result = validateBulkOperations([
        { updateOne: { filter: { _id: '1' }, update: { $set: { x: { $function: { body: 'bad', args: [], lang: 'js' } } } } } },
      ]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/\$function/);
    });
  });

  describe('max operations cap', () => {
    it('accepts operations at the limit', () => {
      const ops = Array.from({ length: MAX_BULK_OPERATIONS }, () => ({
        insertOne: { document: { x: 1 } },
      }));
      const result = validateBulkOperations(ops);
      expect(result.valid).toBe(true);
    });

    it('rejects operations exceeding the limit', () => {
      const ops = Array.from({ length: MAX_BULK_OPERATIONS + 1 }, () => ({
        insertOne: { document: { x: 1 } },
      }));
      const result = validateBulkOperations(ops);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/exceeds.*maximum/i);
    });
  });

  describe('empty operations array', () => {
    it('rejects empty operations array', () => {
      const result = validateBulkOperations([]);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty/i);
    });
  });
});
