import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db, MongoClient } from 'mongodb';
import { registerMonitoringTools } from './monitoring.js';
import { registerDocumentTools } from './document.js';
import { registerAdvancedOperations } from './advanced-operations.js';
import { registerDataQualityTools } from './data-quality.js';
import { registerLiveMonitoringTools } from './live-monitoring.js';
import { validateFieldName } from '../utils/name-validator.js';
import {
  MAX_EXPORT_LIMIT,
  MAX_MONITORING_DURATION,
  MIN_MONITORING_INTERVAL,
  MAX_MONITORING_LIMIT,
} from '../utils/query-limits.js';

// Capture registered tool handlers via mock server
function createMockServer() {
  const registeredTools: Record<string, { schema: any; handler: Function }> = {};
  const server = {
    tool: vi.fn((...args: unknown[]) => {
      const toolName = args[0] as string;
      const schema = args[2];
      const handler = args[args.length - 1] as Function;
      registeredTools[toolName] = { schema, handler };
    }),
  } as unknown as McpServer;
  return { server, registeredTools };
}

function createMockDb() {
  const mockCollection = {
    find: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
    project: vi.fn().mockReturnThis(),
    countDocuments: vi.fn().mockResolvedValue(0),
    indexes: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockReturnThis(),
  };

  const db = {
    collection: vi.fn().mockReturnValue(mockCollection),
    command: vi.fn().mockResolvedValue({ was: 1 }),
    admin: vi.fn().mockReturnValue({
      command: vi.fn().mockResolvedValue({
        opcounters: { insert: 0, query: 0, update: 0, delete: 0, command: 0, getmore: 0 },
        connections: { current: 1 },
        network: { bytesIn: 0, bytesOut: 0, numRequests: 0 },
        mem: { resident: 100 },
        globalLock: {},
      }),
    }),
    listCollections: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    databaseName: 'testdb',
  } as unknown as Db;

  const client = {
    db: vi.fn().mockReturnValue(db),
  } as unknown as MongoClient;

  return { db, client, mockCollection };
}

/**
 * Fix 1: getProfilerStats must reject dangerous operators in filter.
 * Currently filter is passed raw to .find() — this should fail until
 * preprocessQuery is wired in.
 */
describe('Fix 1: getProfilerStats rejects dangerous filter operators', () => {
  it('rejects $where in filter', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, client } = createMockDb();
    registerMonitoringTools(server, client, db, 'testdb', 'read-only');

    const handler = registeredTools['getProfilerStats']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({ filter: { $where: 'sleep(10000)' } });
    // Should error, not silently pass through
    expect(result.content[0].text).toMatch(/\$where.*blocked|blocked.*\$where|error/i);
  });

  it('rejects $function nested in $and filter', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, client } = createMockDb();
    registerMonitoringTools(server, client, db, 'testdb', 'read-only');

    const handler = registeredTools['getProfilerStats']?.handler;
    const result = await handler({
      filter: { $and: [{ millis: { $gt: 100 } }, { $function: { body: 'bad()', args: [], lang: 'js' } }] },
    });
    expect(result.content[0].text).toMatch(/\$function.*blocked|blocked.*\$function|error/i);
  });

  it('allows safe profiler filters', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, client } = createMockDb();
    registerMonitoringTools(server, client, db, 'testdb', 'read-only');

    const handler = registeredTools['getProfilerStats']?.handler;
    const result = await handler({ filter: { millis: { $gt: 100 } } });
    // Should succeed — no error about blocked operators
    expect(result.content[0].text).not.toMatch(/blocked/i);
  });
});

/**
 * Fix 2: cloneCollection, exportCollection, analyzeQueryPerformance must
 * reject dangerous operators in projection.
 */
describe('Fix 2: projection operator blocking in data-quality tools', () => {
  it('cloneCollection rejects $function in projection', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();

    // Mock source collection exists
    (db.listCollections as any).mockReturnValue({
      toArray: vi.fn()
        .mockResolvedValueOnce([{ name: 'users' }])  // source check
        .mockResolvedValueOnce([]),                      // destination check
    });
    (db.command as any).mockResolvedValue({ count: 10, size: 1000 });

    registerDataQualityTools(server, db, 'read-write');

    const handler = registeredTools['cloneCollection']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({
      source: 'users',
      destination: 'users_copy',
      options: {
        projection: {
          name: 1,
          evil: { $function: { body: 'return 1', args: [], lang: 'js' } },
        },
      },
    });
    expect(result.content[0].text).toMatch(/\$function.*blocked|blocked.*\$function/i);
  });

  it('exportCollection rejects $accumulator in projection', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['exportCollection']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({
      collection: 'users',
      options: {
        projection: {
          total: { $accumulator: { init: 'function(){}', accumulate: 'function(){}' } },
        },
      },
    });
    expect(result.content[0].text).toMatch(/\$accumulator.*blocked|blocked.*\$accumulator/i);
  });

  it('analyzeQueryPerformance rejects $function in projection', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['analyzeQueryPerformance']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({
      collection: 'users',
      query: {
        projection: {
          bad: { $function: { body: 'evil()', args: [], lang: 'js' } },
        },
      },
    });
    expect(result.content[0].text).toMatch(/\$function.*blocked|blocked.*\$function/i);
  });

  it('cloneCollection allows safe projections', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();

    // Mock: source exists, destination does not
    (db.listCollections as any).mockReturnValue({
      toArray: vi.fn()
        .mockResolvedValueOnce([{ name: 'users' }])  // source check
        .mockResolvedValueOnce([]),                      // destination check
    });
    (db.command as any).mockResolvedValue({ count: 10, size: 1000 });

    registerDataQualityTools(server, db, 'read-write');
    const handler = registeredTools['cloneCollection']?.handler;

    const result = await handler({
      source: 'users',
      destination: 'users_copy',
      options: { projection: { name: 1, email: 1 }, dryRun: true },
    });
    expect(result.content[0].text).not.toMatch(/blocked/i);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.dryRun).toBe(true);
  });
});

/**
 * Fix 3: Live monitoring schemas must enforce max bounds.
 */
describe('Fix 3: live monitoring duration bounds', () => {
  it('exports MAX_MONITORING_DURATION = 300_000', () => {
    expect(MAX_MONITORING_DURATION).toBe(300_000);
  });

  it('exports MIN_MONITORING_INTERVAL = 100', () => {
    expect(MIN_MONITORING_INTERVAL).toBe(100);
  });

  it('exports MAX_MONITORING_LIMIT = 100', () => {
    expect(MAX_MONITORING_LIMIT).toBe(100);
  });

  it('getLiveMetrics schema rejects duration above max', () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerLiveMonitoringTools(server, db, 'read-only');

    const schema = registeredTools['getLiveMetrics']?.schema;
    expect(schema).toBeDefined();

    const durationSchema = schema.duration;
    expect(durationSchema.safeParse(MAX_MONITORING_DURATION + 1).success).toBe(false);
    expect(durationSchema.safeParse(MAX_MONITORING_DURATION).success).toBe(true);
  });

  it('getLiveMetrics schema rejects interval below minimum', () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerLiveMonitoringTools(server, db, 'read-only');

    const schema = registeredTools['getLiveMetrics']?.schema;
    const intervalSchema = schema.interval;
    expect(intervalSchema.safeParse(MIN_MONITORING_INTERVAL - 1).success).toBe(false);
    expect(intervalSchema.safeParse(MIN_MONITORING_INTERVAL).success).toBe(true);
  });

  it('getLiveMetrics schema rejects interval above max duration', () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerLiveMonitoringTools(server, db, 'read-only');

    const schema = registeredTools['getLiveMetrics']?.schema;
    const intervalSchema = schema.interval;
    expect(intervalSchema.safeParse(MAX_MONITORING_DURATION + 1).success).toBe(false);
    expect(intervalSchema.safeParse(MAX_MONITORING_DURATION).success).toBe(true);
  });

  it('getHottestCollections schema rejects sampleDuration above max', () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerLiveMonitoringTools(server, db, 'read-only');

    const schema = registeredTools['getHottestCollections']?.schema;
    expect(schema).toBeDefined();

    const durationSchema = schema.sampleDuration;
    expect(durationSchema.safeParse(MAX_MONITORING_DURATION + 1).success).toBe(false);
    expect(durationSchema.safeParse(MAX_MONITORING_DURATION).success).toBe(true);
  });

  it('getHottestCollections schema rejects limit above max', () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerLiveMonitoringTools(server, db, 'read-only');

    const schema = registeredTools['getHottestCollections']?.schema;
    const limitSchema = schema.limit;
    expect(limitSchema.safeParse(MAX_MONITORING_LIMIT + 1).success).toBe(false);
    expect(limitSchema.safeParse(MAX_MONITORING_LIMIT).success).toBe(true);
  });
});

/**
 * Fix 4: exportCollection must apply default limit when omitted.
 */
describe('Fix 4: exportCollection default limit', () => {
  it('applies limit to cursor even when caller omits it', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['exportCollection']?.handler;
    expect(handler).toBeDefined();

    // Call without limit
    await handler({ collection: 'users' });

    // cursor.limit() should have been called with MAX_EXPORT_LIMIT
    expect(mockCollection.limit).toHaveBeenCalledWith(MAX_EXPORT_LIMIT);
  });

  it('preserves explicit limit when provided', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['exportCollection']?.handler;
    await handler({ collection: 'users', options: { limit: 50 } });

    expect(mockCollection.limit).toHaveBeenCalledWith(50);
  });
});

/**
 * Fix 6 (Issue 6): Aggregation result size must be capped in ALL aggregation paths,
 * not just document.ts aggregate tool. safeAggregate in data-quality.ts
 * and groupBy paths in temporal.ts must also apply capResultSize.
 */
describe('Fix 6: aggregation output size capped in data-quality tools', () => {
  it('findDuplicates caps large aggregation results', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();

    // Return a result that exceeds 1MB when serialized
    const bigDoc = { _id: { field: 'val' }, count: 2, duplicates: [{ data: 'x'.repeat(200_000) }] };
    const bigResult = Array.from({ length: 10 }, (_, i) => ({ ...bigDoc, _id: { field: `val${i}` } }));
    mockCollection.toArray.mockResolvedValue(bigResult);

    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['findDuplicates']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({ collection: 'users', fields: ['email'] });
    const text = result.content[0].text;
    // Output should be capped — either truncated warning or size under 1MB
    const outputSize = Buffer.byteLength(text, 'utf-8');
    expect(outputSize).toBeLessThanOrEqual(1_200_000); // 1MB + some overhead for warning text
  });
});

/**
 * Fix 9 (Issue 9): Deeply nested filters must be rejected through tool handlers,
 * not just at the unit level. This tests the integration path.
 */
describe('Fix 9: filter nesting depth limit via tool handler', () => {
  function buildNestedFilter(depth: number): Record<string, any> {
    let filter: Record<string, any> = { status: 'active' };
    for (let i = 0; i < depth; i++) {
      filter = { $or: [filter, { level: i }] };
    }
    return filter;
  }

  it('getProfilerStats rejects filter nested 11 levels deep', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, client } = createMockDb();
    registerMonitoringTools(server, client, db, 'testdb', 'read-only');

    const handler = registeredTools['getProfilerStats']?.handler;
    expect(handler).toBeDefined();

    const deepFilter = buildNestedFilter(11);
    const result = await handler({ filter: deepFilter });
    expect(result.content[0].text).toMatch(/depth|nesting/i);
  });

  it('getProfilerStats allows filter nested 10 levels deep', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, client } = createMockDb();
    registerMonitoringTools(server, client, db, 'testdb', 'read-only');

    const handler = registeredTools['getProfilerStats']?.handler;
    const okFilter = buildNestedFilter(10);
    const result = await handler({ filter: okFilter });
    expect(result.content[0].text).not.toMatch(/depth|nesting/i);
  });
});

/**
 * Fix 5: Field names in exploreRelationships must be validated.
 */
describe('Fix 5: field name validation', () => {
  it('rejects field names starting with $', () => {
    const result = validateFieldName('$where');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/\$/);
  });

  it('rejects field names containing null bytes', () => {
    const result = validateFieldName('field\0name');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/null/i);
  });

  it('rejects empty field names', () => {
    const result = validateFieldName('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('accepts normal field names', () => {
    expect(validateFieldName('userId').valid).toBe(true);
    expect(validateFieldName('order_id').valid).toBe(true);
    expect(validateFieldName('nested.field.path').valid).toBe(true);
    expect(validateFieldName('_id').valid).toBe(true);
  });

  it('exploreRelationships rejects $-prefixed localField', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['exploreRelationships']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({
      collection: 'users',
      documentId: '507f1f77bcf86cd799439011',
      relationships: [{
        localField: '$where',
        foreignCollection: 'orders',
        foreignField: 'userId',
      }],
    });
    expect(result.content[0].text).toMatch(/\$|field name|error/i);
    expect(result.isError).toBe(true);
  });

  it('exploreRelationships rejects $-prefixed foreignField', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerDataQualityTools(server, db, 'read-only');

    const handler = registeredTools['exploreRelationships']?.handler;
    const result = await handler({
      collection: 'users',
      documentId: '507f1f77bcf86cd799439011',
      relationships: [{
        localField: 'userId',
        foreignCollection: 'orders',
        foreignField: '$function',
      }],
    });
    expect(result.content[0].text).toMatch(/\$|field name|error/i);
    expect(result.isError).toBe(true);
  });
});

/**
 * Fix 11 (CRITICAL): aggregate options.out bypass — read-only mode can write
 * via legacy `out` option in aggregate options object.
 * sanitizeAggregateOptions must strip `out` and other write-enabling keys.
 */
describe('Fix 11: aggregate options.out bypass is blocked', () => {
  it('strips options.out from aggregate call (string format)', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDocumentTools(server, db, 'read-only');

    const handler = registeredTools['aggregate']?.handler;
    expect(handler).toBeDefined();

    await handler({
      collection: 'users',
      pipeline: [{ $match: {} }],
      options: { out: 'pwned' },
    });

    // Verify aggregate was called with options that do NOT contain `out`
    const callArgs = mockCollection.aggregate.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('out');
  });

  it('strips options.out from aggregate call (object format)', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDocumentTools(server, db, 'read-only');

    const handler = registeredTools['aggregate']?.handler;
    await handler({
      collection: 'users',
      pipeline: [{ $match: {} }],
      options: { out: { db: 'admin', coll: 'x' } },
    });

    const callArgs = mockCollection.aggregate.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('out');
  });

  it('strips writeConcern and bypassDocumentValidation from aggregate options', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDocumentTools(server, db, 'read-only');

    const handler = registeredTools['aggregate']?.handler;
    await handler({
      collection: 'users',
      pipeline: [{ $match: {} }],
      options: { writeConcern: { w: 1 }, bypassDocumentValidation: true, comment: 'legit' },
    });

    const callArgs = mockCollection.aggregate.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('writeConcern');
    expect(callArgs[1]).not.toHaveProperty('bypassDocumentValidation');
    expect(callArgs[1]).toHaveProperty('comment', 'legit');
  });

  it('preserves safe options (maxTimeMS, allowDiskUse, hint)', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDocumentTools(server, db, 'read-only');

    const handler = registeredTools['aggregate']?.handler;
    await handler({
      collection: 'users',
      pipeline: [{ $match: {} }],
      options: { maxTimeMS: 5000, allowDiskUse: true, hint: { _id: 1 } },
    });

    const callArgs = mockCollection.aggregate.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('maxTimeMS', 5000);
    expect(callArgs[1]).toHaveProperty('allowDiskUse', true);
    expect(callArgs[1]).toHaveProperty('hint');
  });

  it('blocks options.out in read-write mode too (consistent with $out pipeline block)', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    registerDocumentTools(server, db, 'read-write');

    const handler = registeredTools['aggregate']?.handler;
    await handler({
      collection: 'users',
      pipeline: [{ $match: {} }],
      options: { out: 'pwned' },
    });

    const callArgs = mockCollection.aggregate.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('out');
  });
});

/**
 * Fix 12 (MEDIUM): explainQuery allows UPDATE/DELETE plans on read-only.
 * Write operation plans should be blocked in read-only mode.
 */
describe('Fix 12: explainQuery blocks write operations in read-only mode', () => {
  it('rejects operation: "update" in read-only mode', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerAdvancedOperations(server, db, 'read-only');

    const handler = registeredTools['explainQuery']?.handler;
    expect(handler).toBeDefined();

    const result = await handler({
      collection: 'users',
      operation: 'update',
      query: { _id: 1 },
      update: { $set: { hacked: true } },
    });
    expect(result.content[0].text).toMatch(/read-only|not allowed|blocked/i);
  });

  it('rejects operation: "delete" in read-only mode', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerAdvancedOperations(server, db, 'read-only');

    const handler = registeredTools['explainQuery']?.handler;
    const result = await handler({
      collection: 'users',
      operation: 'delete',
      query: { _id: 1 },
    });
    expect(result.content[0].text).toMatch(/read-only|not allowed|blocked/i);
  });

  it('allows operation: "find" in read-only mode', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    const mockExplain = vi.fn().mockResolvedValue({ queryPlanner: {} });
    mockCollection.find = vi.fn().mockReturnValue({ explain: mockExplain });
    registerAdvancedOperations(server, db, 'read-only');

    const handler = registeredTools['explainQuery']?.handler;
    const result = await handler({
      collection: 'users',
      operation: 'find',
      query: { status: 'active' },
    });
    expect(result.content[0].text).not.toMatch(/read-only|not allowed|blocked/i);
  });

  it('allows operation: "aggregate" in read-only mode', async () => {
    const { server, registeredTools } = createMockServer();
    const { db, mockCollection } = createMockDb();
    const mockExplain = vi.fn().mockResolvedValue({ queryPlanner: {} });
    mockCollection.aggregate = vi.fn().mockReturnValue({ explain: mockExplain, toArray: vi.fn().mockResolvedValue([]) });
    registerAdvancedOperations(server, db, 'read-only');

    const handler = registeredTools['explainQuery']?.handler;
    const result = await handler({
      collection: 'users',
      operation: 'aggregate',
      query: {},
      pipeline: [{ $match: {} }],
    });
    expect(result.content[0].text).not.toMatch(/read-only|not allowed|blocked/i);
  });

  it('allows operation: "update" in read-write mode', async () => {
    const { server, registeredTools } = createMockServer();
    const { db } = createMockDb();
    registerAdvancedOperations(server, db, 'read-write');

    const handler = registeredTools['explainQuery']?.handler;
    const result = await handler({
      collection: 'users',
      operation: 'update',
      query: { _id: 1 },
      update: { $set: { x: 1 } },
    });
    // Should not be blocked in read-write mode
    expect(result.content[0].text).not.toMatch(/read-only|not allowed|blocked/i);
  });
});
