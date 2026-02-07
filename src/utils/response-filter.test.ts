import { describe, it, expect } from 'vitest';
import {
  excludeZeroMetrics,
  filterCollectionStats,
  filterDatabaseStats,
  filterServerStatus,
  filterProfilerEntry,
  filterSlowOperation,
} from './response-filter.js';

describe('excludeZeroMetrics', () => {
  it('removes zero values', () => {
    expect(excludeZeroMetrics({ a: 1, b: 0, c: 3 })).toEqual({ a: 1, c: 3 });
  });

  it('removes null and undefined values', () => {
    expect(excludeZeroMetrics({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it('removes empty arrays', () => {
    expect(excludeZeroMetrics({ a: [1], b: [] })).toEqual({ a: [1] });
  });

  it('removes empty objects', () => {
    expect(excludeZeroMetrics({ a: { x: 1 }, b: {} })).toEqual({ a: { x: 1 } });
  });

  it('keeps non-zero falsy values like empty string and false', () => {
    const result = excludeZeroMetrics({ a: '', b: false });
    expect(result).toEqual({ a: '', b: false });
  });
});

describe('filterCollectionStats', () => {
  const fullStats = {
    ns: 'test.col',
    count: 100,
    size: 5000,
    avgObjSize: 50,
    storageSize: 8000,
    nindexes: 2,
    totalIndexSize: 1000,
    indexSizes: { _id_: 500 },
    capped: false,
    max: 0,
    freeStorageSize: 200,
    extra: 'hidden',
  };

  it('returns full stats at verbosity "full"', () => {
    expect(filterCollectionStats(fullStats, 'full')).toBe(fullStats);
  });

  it('returns summary fields at verbosity "summary"', () => {
    const result = filterCollectionStats(fullStats, 'summary');
    expect(result.ns).toBe('test.col');
    expect(result.count).toBe(100);
    expect(result).not.toHaveProperty('capped');
    expect(result).not.toHaveProperty('extra');
  });

  it('includes standard fields at verbosity "standard"', () => {
    const result = filterCollectionStats(fullStats, 'standard');
    expect(result.capped).toBe(false);
    expect(result.freeStorageSize).toBe(200);
    expect(result).not.toHaveProperty('extra');
  });
});

describe('filterDatabaseStats', () => {
  const stats = {
    db: 'test',
    collections: 5,
    views: 0,
    objects: 1000,
    avgObjSize: 200,
    dataSize: 200000,
    storageSize: 300000,
    indexes: 10,
    indexSize: 50000,
    totalSize: 350000,
    scaleFactor: 1,
    freeStorageSize: 10000,
    extra: 'hidden',
  };

  it('returns all at "full"', () => {
    expect(filterDatabaseStats(stats, 'full')).toBe(stats);
  });

  it('returns summary subset', () => {
    const result = filterDatabaseStats(stats, 'summary');
    expect(result.db).toBe('test');
    expect(result).not.toHaveProperty('scaleFactor');
    expect(result).not.toHaveProperty('extra');
  });

  it('includes standard fields', () => {
    const result = filterDatabaseStats(stats, 'standard');
    expect(result.scaleFactor).toBe(1);
    expect(result).not.toHaveProperty('extra');
  });
});

describe('filterServerStatus', () => {
  const stats = {
    version: '7.0',
    wiredTiger: { cache: {} },
    repl: { setName: 'rs0' },
    storageEngine: { name: 'wiredTiger' },
  };

  it('removes wiredTiger by default', () => {
    const result = filterServerStatus(stats, {});
    expect(result).not.toHaveProperty('wiredTiger');
  });

  it('keeps wiredTiger when requested', () => {
    const result = filterServerStatus(stats, { includeWiredTiger: true });
    expect(result).toHaveProperty('wiredTiger');
  });

  it('removes repl by default', () => {
    const result = filterServerStatus(stats, {});
    expect(result).not.toHaveProperty('repl');
  });

  it('keeps repl when requested', () => {
    const result = filterServerStatus(stats, { includeReplication: true });
    expect(result).toHaveProperty('repl');
  });

  it('removes storageEngine by default', () => {
    const result = filterServerStatus(stats, {});
    expect(result).not.toHaveProperty('storageEngine');
  });

  it('keeps storageEngine when requested', () => {
    const result = filterServerStatus(stats, { includeStorageEngine: true });
    expect(result).toHaveProperty('storageEngine');
  });
});

describe('filterProfilerEntry', () => {
  const entry = {
    op: 'query',
    ns: 'test.col',
    millis: 150,
    ts: new Date(),
    planSummary: 'COLLSCAN',
    docsExamined: 1000,
    keysExamined: 0,
    nreturned: 10,
    user: 'admin',
    extra: 'hidden',
  };

  it('returns full entry at "full"', () => {
    expect(filterProfilerEntry(entry, 'full')).toBe(entry);
  });

  it('returns minimal fields at "summary"', () => {
    const result = filterProfilerEntry(entry, 'summary');
    expect(result.op).toBe('query');
    expect(result.millis).toBe(150);
    expect(result).not.toHaveProperty('planSummary');
    expect(result).not.toHaveProperty('extra');
  });

  it('includes standard fields', () => {
    const result = filterProfilerEntry(entry, 'standard');
    expect(result.planSummary).toBe('COLLSCAN');
    expect(result.docsExamined).toBe(1000);
    expect(result).not.toHaveProperty('extra');
  });
});

describe('filterSlowOperation', () => {
  const op = {
    opid: 123,
    secs_running: 10,
    query: { find: 'col' },
    lockStats: { global: {} },
    ns: 'test.col',
  };

  it('returns full op when includeQueryDetails is true', () => {
    expect(filterSlowOperation(op, true)).toBe(op);
  });

  it('removes query and lockStats when includeQueryDetails is false', () => {
    const result = filterSlowOperation(op, false);
    expect(result).not.toHaveProperty('query');
    expect(result).not.toHaveProperty('lockStats');
    expect(result.opid).toBe(123);
  });
});
