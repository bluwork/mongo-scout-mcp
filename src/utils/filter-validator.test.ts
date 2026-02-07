import { describe, it, expect } from 'vitest';
import { validateFilter, shouldBlockFilter, getOperationWarning } from './filter-validator.js';

describe('validateFilter', () => {
  it('flags empty filter as isEmpty and isMatchAll', () => {
    const result = validateFilter({});
    expect(result.isEmpty).toBe(true);
    expect(result.isMatchAll).toBe(true);
    expect(result.warning).toContain('ALL documents');
  });

  it('passes non-empty filter', () => {
    const result = validateFilter({ status: 'active' });
    expect(result.isEmpty).toBe(false);
    expect(result.isMatchAll).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('always returns isValid true', () => {
    expect(validateFilter({}).isValid).toBe(true);
    expect(validateFilter({ a: 1 }).isValid).toBe(true);
  });
});

describe('shouldBlockFilter', () => {
  it('blocks empty filter by default', () => {
    const result = shouldBlockFilter({});
    expect(result.blocked).toBe(true);
    expect(result.reason).toBeDefined();
  });

  it('allows empty filter when allowEmptyFilter is true', () => {
    const result = shouldBlockFilter({}, true);
    expect(result.blocked).toBe(false);
  });

  it('does not block non-empty filter', () => {
    const result = shouldBlockFilter({ name: 'test' });
    expect(result.blocked).toBe(false);
  });

  it('includes operation name in blocked reason', () => {
    const result = shouldBlockFilter({}, false, 'Delete');
    expect(result.reason).toContain('Delete');
  });
});

describe('getOperationWarning', () => {
  it('returns undefined for count 0', () => {
    expect(getOperationWarning(0, 'update')).toBeUndefined();
  });

  it('returns undefined for small counts (1-10)', () => {
    expect(getOperationWarning(5, 'delete')).toBeUndefined();
    expect(getOperationWarning(10, 'update')).toBeUndefined();
  });

  it('returns warning for 11-99 documents', () => {
    const warning = getOperationWarning(50, 'update');
    expect(warning).toContain('50');
    expect(warning).toContain('update');
  });

  it('returns warning for 100-999 documents', () => {
    const warning = getOperationWarning(500, 'delete');
    expect(warning).toContain('500');
    expect(warning).toContain('Large operation');
  });

  it('returns double warning for 1000+ documents', () => {
    const warning = getOperationWarning(5000, 'delete');
    expect(warning).toContain('LARGE OPERATION');
  });
});
