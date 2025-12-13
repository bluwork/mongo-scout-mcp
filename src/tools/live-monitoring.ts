import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { checkAdminRateLimit, ADMIN_RATE_LIMIT } from '../utils/rate-limiter.js';
import { sanitizeResponse } from '../utils/sanitize.js';
import type {
  ServerStatus,
  LiveMetric,
  HottestCollection,
  CollectionStats,
  IndexUsageStat,
  ProfilerEntry,
  ProfilerStatus,
  SlowOperation,
  CurrentOpCommand,
  CurrentOpResult
} from '../types.js';
import { filterSlowOperation } from '../utils/response-filter.js';

export function registerLiveMonitoringTools(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'getLiveMetrics',
    'Get real-time performance metrics with continuous updates. Use includeRawSamples=false to get just the summary for token efficiency.',
    {
      duration: z.number().positive().optional(),
      interval: z.number().positive().optional(),
      includeRawSamples: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getLiveMetrics', args);
      const { duration = 60000, interval = 1000, includeRawSamples = false } = args;

      if (!checkAdminRateLimit('getLiveMetrics')) {
        return {
          content: [
            {
              type: 'text',
              text: `Rate limit exceeded for getLiveMetrics. Maximum ${ADMIN_RATE_LIMIT} requests per minute.`,
            },
          ],
        };
      }

      try {
        const startTime = Date.now();
        const metrics: LiveMetric[] = [];

        let previousStatus = await db.admin().command({ serverStatus: 1 }) as ServerStatus;

        while (Date.now() - startTime < duration) {
          await new Promise(resolve => setTimeout(resolve, interval));

          const currentStatus = await db.admin().command({ serverStatus: 1 }) as ServerStatus;

          const currentOps = currentStatus.opcounters!;
          const prevOps = previousStatus.opcounters!;
          const opsPerSec = {
            insert: (currentOps.insert - prevOps.insert) / (interval / 1000),
            query: (currentOps.query - prevOps.query) / (interval / 1000),
            update: (currentOps.update - prevOps.update) / (interval / 1000),
            delete: (currentOps.delete - prevOps.delete) / (interval / 1000),
            command: (currentOps.command - prevOps.command) / (interval / 1000),
            getmore: (currentOps.getmore - prevOps.getmore) / (interval / 1000)
          };

          const currentNet = currentStatus.network!;
          const prevNet = previousStatus.network!;
          const networkRates = {
            bytesInPerSec: (currentNet.bytesIn - prevNet.bytesIn) / (interval / 1000),
            bytesOutPerSec: (currentNet.bytesOut - prevNet.bytesOut) / (interval / 1000),
            requestsPerSec: (currentNet.numRequests - prevNet.numRequests) / (interval / 1000)
          };

          metrics.push({
            timestamp: new Date().toISOString(),
            operations: {
              counters: currentOps,
              ratesPerSecond: opsPerSec
            },
            connections: currentStatus.connections!,
            network: {
              totals: currentNet,
              ratesPerSecond: networkRates
            },
            memory: currentStatus.mem!,
            globalLock: currentStatus.globalLock!
          });

          previousStatus = currentStatus;
        }

        const summary = {
          avgOpsPerSecond: {
            insert: metrics.reduce((sum, m) => sum + m.operations.ratesPerSecond.insert, 0) / metrics.length,
            query: metrics.reduce((sum, m) => sum + m.operations.ratesPerSecond.query, 0) / metrics.length,
            update: metrics.reduce((sum, m) => sum + m.operations.ratesPerSecond.update, 0) / metrics.length,
            delete: metrics.reduce((sum, m) => sum + m.operations.ratesPerSecond.delete, 0) / metrics.length,
          },
          peakConnections: Math.max(...metrics.map(m => m.connections.current)),
          avgMemoryMB: metrics.reduce((sum, m) => sum + m.memory.resident, 0) / metrics.length
        };

        const response: Record<string, unknown> = {
          duration,
          interval,
          samples: metrics.length,
          summary
        };

        // Only include raw samples if requested (can be very verbose)
        if (includeRawSamples) {
          response.metrics = metrics;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getLiveMetrics', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting live metrics: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getHottestCollections',
    'Get collections with highest activity based on operation counts',
    {
      limit: z.number().positive().optional(),
      sampleDuration: z.number().positive().optional(),
    },
    async (args) => {
      logToolUsage('getHottestCollections', args);
      const { limit = 10, sampleDuration = 5000 } = args;

      try {
        const collections = await db.listCollections().toArray();
        const collectionStats: HottestCollection[] = [];

        const initialStatus = await db.admin().command({ serverStatus: 1 }) as ServerStatus;

        const initialCollectionOps = new Map<string, { operations: number; stats: CollectionStats }>();
        for (const coll of collections) {
          try {
            const stats = await db.command({
              collStats: coll.name,
              indexDetails: false
            }) as unknown as CollectionStats & { wiredTiger?: Record<string, Record<string, number>> };
            initialCollectionOps.set(coll.name, {
              operations: (stats.wiredTiger?.cursor?.['insert calls'] || 0) +
                         (stats.wiredTiger?.cursor?.['update calls'] || 0) +
                         (stats.wiredTiger?.cursor?.['remove calls'] || 0),
              stats
            });
          } catch (e) {
            continue;
          }
        }

        const operationCounts = new Map<string, number>();
        const startTime = Date.now();

        while (Date.now() - startTime < sampleDuration) {
          const currentOps = await db.admin().command({
            currentOp: true,
            "$all": true
          }) as CurrentOpResult;

          currentOps.inprog.forEach((op) => {
            if (op.ns && op.active) {
              const collName = op.ns.split('.').slice(1).join('.');
              if (collName) {
                operationCounts.set(collName, (operationCounts.get(collName) || 0) + 1);
              }
            }
          });

          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const finalStatus = await db.admin().command({ serverStatus: 1 }) as ServerStatus;
        const finalOps = finalStatus.opcounters!;
        const initialOps = initialStatus.opcounters!;
        const totalOps = finalOps.insert + finalOps.query +
                        finalOps.update + finalOps.delete -
                        (initialOps.insert + initialOps.query +
                         initialOps.update + initialOps.delete);

        for (const coll of collections) {
          try {
            const stats = await db.command({
              collStats: coll.name,
              indexDetails: false
            });

            const activeOps = operationCounts.get(coll.name) || 0;
            const percentage = totalOps > 0 ? (activeOps / totalOps) * 100 : 0;

            collectionStats.push({
              collection: coll.name,
              namespace: `${db.databaseName}.${coll.name}`,
              activeOperations: activeOps,
              percentageOfTotal: parseFloat(percentage.toFixed(2)),
              size: stats.size,
              count: stats.count,
              avgObjSize: stats.avgObjSize,
              indexes: stats.nindexes,
              readWriteRatio: 'N/A'
            });
          } catch (e) {
            continue;
          }
        }

        const hottest = collectionStats
          .sort((a, b) => b.activeOperations - a.activeOperations)
          .slice(0, limit);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sampleDuration,
                totalOperations: totalOps,
                collections: hottest
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getHottestCollections', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting hottest collections: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getCollectionMetrics',
    'Get detailed performance metrics for a specific collection. Use includeWiredTiger=false for token efficiency.',
    {
      collection: z.string(),
      includeWiredTiger: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getCollectionMetrics', args);
      const { collection, includeWiredTiger = false } = args;

      try {
        // Try with indexDetails first, fall back without it for MongoDB 8.0+
        let stats;
        try {
          stats = await db.command({
            collStats: collection,
            indexDetails: true
          });
        } catch (e) {
          // MongoDB 8.0+ deprecated indexDetails, try without it
          stats = await db.command({
            collStats: collection
          });
        }

        let indexUsage: IndexUsageStat[] = [];
        try {
          indexUsage = await db.collection(collection).aggregate([
            { $indexStats: {} }
          ]).toArray() as IndexUsageStat[];
        } catch (e) {
          // $indexStats might not be available
        }

        let recentOps: ProfilerEntry[] = [];
        let operationCounts = {
          insert: 0,
          query: 0,
          update: 0,
          delete: 0
        };

        try {
          const profileStatus = await db.command({ profile: -1 }) as ProfilerStatus;
          if (profileStatus.was > 0) {
            recentOps = await db.collection('system.profile')
              .find({ ns: `${db.databaseName}.${collection}` })
              .sort({ ts: -1 })
              .limit(100)
              .toArray() as unknown as ProfilerEntry[];

            recentOps.forEach(op => {
              if (op.op === 'insert') operationCounts.insert++;
              else if (op.op === 'query' || op.op === 'find') operationCounts.query++;
              else if (op.op === 'update') operationCounts.update++;
              else if (op.op === 'remove' || op.op === 'delete') operationCounts.delete++;
            });
          }
        } catch (e) {
          // Profiling might not be enabled
        }

        const currentOpsCommand: CurrentOpCommand = {
          currentOp: true,
          $all: true,
          ns: `${db.databaseName}.${collection}`
        };
        const currentOps = await db.admin().command(currentOpsCommand) as CurrentOpResult;

        const activeOperations = currentOps.inprog.filter((op) => op.active);

        let opsPerSecond = null;
        if (recentOps.length > 1) {
          const timeSpan = (recentOps[0].ts.getTime() - recentOps[recentOps.length - 1].ts.getTime()) / 1000;
          if (timeSpan > 0) {
            opsPerSecond = {
              insert: operationCounts.insert / timeSpan,
              query: operationCounts.query / timeSpan,
              update: operationCounts.update / timeSpan,
              delete: operationCounts.delete / timeSpan,
              total: (operationCounts.insert + operationCounts.query +
                     operationCounts.update + operationCounts.delete) / timeSpan
            };
          }
        }

        const metrics = {
          collection,
          namespace: `${db.databaseName}.${collection}`,
          storage: {
            documents: stats.count,
            size: stats.size,
            avgDocumentSize: stats.avgObjSize,
            storageSize: stats.storageSize,
            freeStorageSize: stats.freeStorageSize || 0,
            capped: stats.capped || false,
            max: stats.max || null
          },
          indexes: {
            count: stats.nindexes,
            totalSize: stats.totalIndexSize,
            details: stats.indexSizes || {},
            usage: indexUsage.map(idx => ({
              name: idx.name,
              operations: idx.accesses?.ops || 0,
              since: idx.accesses?.since || null
            }))
          },
          operations: {
            current: {
              active: activeOperations.length,
              operations: activeOperations.map((op) => ({
                operation: op.op,
                duration: op.secs_running || 0,
                opid: op.opid
              }))
            },
            recent: {
              count: recentOps.length,
              breakdown: operationCounts
            },
            ratesPerSecond: opsPerSecond
          }
        };

        // Only include WiredTiger stats if requested (can be very verbose)
        if (includeWiredTiger) {
          (metrics as Record<string, unknown>).wiredTiger = stats.wiredTiger || null;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(metrics, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getCollectionMetrics', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting collection metrics: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getSlowestOperations',
    'Get slow operations from both profiler and currently running operations. Use includeQueryDetails=false for token efficiency. Note: Enabling profiling requires read-write mode.',
    {
      minDuration: z.number().min(0).optional(),
      limit: z.number().positive().optional(),
      includeRunning: z.boolean().optional(),
      includeQueryDetails: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getSlowestOperations', args);
      const { minDuration = 100, limit = 10, includeRunning = true, includeQueryDetails = false } = args;

      try {
        const result: {
          profiledOperations: SlowOperation[];
          currentSlowOperations: SlowOperation[];
          profilingStatus: ProfilerStatus | { error: string } | null;
        } = {
          profiledOperations: [],
          currentSlowOperations: [],
          profilingStatus: null
        };

        let originalProfilingLevel: number | null = null;
        let originalSlowMs: number | null = null;

        try {
          const profileStatus = await db.command({ profile: -1 }) as ProfilerStatus;
          result.profilingStatus = profileStatus;

          if (profileStatus.was === 0) {
            if (mode === 'read-write') {
              try {
                originalProfilingLevel = profileStatus.was;
                originalSlowMs = profileStatus.slowms ?? 100;
                await db.command({ profile: 1, slowms: minDuration });
                result.profilingStatus = { was: 1, slowms: minDuration, enabled: 'temporarily', ok: 1 };
              } catch (e) {
                if (result.profilingStatus && 'was' in result.profilingStatus) {
                  result.profilingStatus.message = 'Profiling is disabled and could not be enabled automatically';
                }
              }
            } else {
              if (result.profilingStatus && 'was' in result.profilingStatus) {
                result.profilingStatus.message = 'Profiling is disabled. Enable it manually or use read-write mode to auto-enable.';
              }
            }
          }

          const profiledOps = await db.collection('system.profile')
            .find({
              millis: { $gte: minDuration },
              ns: { $ne: `${db.databaseName}.system.profile` }
            })
            .sort({ ts: -1 })
            .limit(limit)
            .toArray();

          result.profiledOperations = profiledOps.map(op => ({
            operation: op.op,
            namespace: op.ns,
            duration: op.millis,
            timestamp: op.ts,
            query: sanitizeResponse(op.command || op.query || {}),
            planSummary: op.planSummary || 'N/A',
            docsExamined: op.docsExamined || 0,
            keysExamined: op.keysExamined || 0,
            writeConflicts: op.writeConflicts || 0,
            user: op.user || 'N/A',
            client: op.client || 'N/A'
          }));
        } catch (e) {
          result.profiledOperations = [];
          result.profilingStatus = { error: 'Could not access profiler data' };
        } finally {
          // Restore original profiling state if we temporarily enabled it
          if (originalProfilingLevel !== null) {
            try {
              await db.command({ profile: originalProfilingLevel, slowms: originalSlowMs });
            } catch (e) {
              // Log but don't fail if we can't restore profiling state
            }
          }
        }

        if (includeRunning) {
          const currentOpsCommand: CurrentOpCommand = {
            currentOp: true,
            $all: true,
            microsecs_running: { $gte: minDuration * 1000 }
          };
          const currentOps = await db.admin().command(currentOpsCommand) as CurrentOpResult;

          result.currentSlowOperations = currentOps.inprog
            .filter((op) => op.active && op.microsecs_running >= minDuration * 1000)
            .sort((a, b) => b.microsecs_running - a.microsecs_running)
            .slice(0, limit)
            .map((op): SlowOperation => ({
              operation: op.op,
              namespace: op.ns,
              duration: Math.round(op.microsecs_running / 1000),
              runningTime: op.secs_running,
              active: true,
              opid: op.opid,
              query: sanitizeResponse(op.command || {}),
              client: op.client || 'N/A',
              appName: op.appName || 'N/A',
              waitingForLock: (op as unknown as { waitingForLock?: boolean }).waitingForLock || false,
              lockStats: (op as unknown as { lockStats?: Record<string, unknown> }).lockStats || {},
              killable: op.op !== 'none',
              source: 'currentOp'
            }));
        }

        const allOperations: SlowOperation[] = [
          ...result.profiledOperations.map((op) => ({ ...op, source: 'profiler' as const })),
          ...result.currentSlowOperations
        ].sort((a, b) => b.duration - a.duration);

        const summary = {
          totalSlowOperations: allOperations.length,
          averageDuration: allOperations.length > 0
            ? Math.round(allOperations.reduce((sum, op) => sum + op.duration, 0) / allOperations.length)
            : 0,
          slowestOperation: allOperations[0] || null,
          operationTypes: allOperations.reduce((acc: Record<string, number>, op) => {
            acc[op.operation] = (acc[op.operation] || 0) + 1;
            return acc;
          }, {}),
          namespaces: [...new Set(allOperations.map(op => op.namespace))].slice(0, 10)
        };

        // Filter operations based on includeQueryDetails flag
        const filteredOperations = includeQueryDetails
          ? allOperations.slice(0, limit)
          : allOperations.slice(0, limit).map(op =>
              filterSlowOperation(op as unknown as Record<string, unknown>, includeQueryDetails) as unknown as SlowOperation
            );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary,
                profilingStatus: result.profilingStatus,
                operations: filteredOperations
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getSlowestOperations', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting slow operations: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}
