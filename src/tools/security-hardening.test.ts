import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db, MongoClient } from 'mongodb';
import { registerMonitoringTools } from './monitoring.js';
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
