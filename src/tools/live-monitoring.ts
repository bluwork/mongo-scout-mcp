import type { Db } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { checkAdminRateLimit, ADMIN_RATE_LIMIT } from '../utils/rate-limiter.js';
import { sanitizeResponse } from '../utils/sanitize.js';

export function registerLiveMonitoringTools(server: McpServer, db: Db, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'getLiveMetrics',
    'Get real-time performance metrics with continuous updates',
    {
      duration: z.number().positive().optional(),
      interval: z.number().positive().optional(),
    },
    async (args) => {
      logToolUsage('getLiveMetrics', args);
      const { duration = 60000, interval = 1000 } = args;

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
        const metrics: any[] = [];

        let previousStatus = await db.admin().command({ serverStatus: 1 });

        while (Date.now() - startTime < duration) {
          await new Promise(resolve => setTimeout(resolve, interval));

          const currentStatus = await db.admin().command({ serverStatus: 1 });

          const opsPerSec = {
            insert: (currentStatus.opcounters.insert - previousStatus.opcounters.insert) / (interval / 1000),
            query: (currentStatus.opcounters.query - previousStatus.opcounters.query) / (interval / 1000),
            update: (currentStatus.opcounters.update - previousStatus.opcounters.update) / (interval / 1000),
            delete: (currentStatus.opcounters.delete - previousStatus.opcounters.delete) / (interval / 1000),
            command: (currentStatus.opcounters.command - previousStatus.opcounters.command) / (interval / 1000),
            getmore: (currentStatus.opcounters.getmore - previousStatus.opcounters.getmore) / (interval / 1000)
          };

          const networkRates = {
            bytesInPerSec: (currentStatus.network.bytesIn - previousStatus.network.bytesIn) / (interval / 1000),
            bytesOutPerSec: (currentStatus.network.bytesOut - previousStatus.network.bytesOut) / (interval / 1000),
            requestsPerSec: (currentStatus.network.numRequests - previousStatus.network.numRequests) / (interval / 1000)
          };

          metrics.push({
            timestamp: new Date().toISOString(),
            operations: {
              counters: currentStatus.opcounters,
              ratesPerSecond: opsPerSec
            },
            connections: currentStatus.connections,
            network: {
              totals: currentStatus.network,
              ratesPerSecond: networkRates
            },
            memory: currentStatus.mem,
            globalLock: currentStatus.globalLock
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                duration,
                interval,
                samples: metrics.length,
                summary,
                metrics
              }, null, 2),
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
        const collectionStats: any[] = [];

        const initialStatus = await db.admin().command({ serverStatus: 1 });

        const initialCollectionOps = new Map<string, any>();
        for (const coll of collections) {
          try {
            const stats = await db.command({
              collStats: coll.name,
              indexDetails: false
            });
            initialCollectionOps.set(coll.name, {
              operations: stats.wiredTiger?.cursor?.['insert calls'] || 0 +
                         stats.wiredTiger?.cursor?.['update calls'] || 0 +
                         stats.wiredTiger?.cursor?.['remove calls'] || 0,
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
          });

          currentOps.inprog.forEach((op: any) => {
            if (op.ns && op.active) {
              const collName = op.ns.split('.').slice(1).join('.');
              if (collName) {
                operationCounts.set(collName, (operationCounts.get(collName) || 0) + 1);
              }
            }
          });

          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const finalStatus = await db.admin().command({ serverStatus: 1 });
        const totalOps = finalStatus.opcounters.insert + finalStatus.opcounters.query +
                        finalStatus.opcounters.update + finalStatus.opcounters.delete -
                        (initialStatus.opcounters.insert + initialStatus.opcounters.query +
                         initialStatus.opcounters.update + initialStatus.opcounters.delete);

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
    'Get detailed performance metrics for a specific collection',
    {
      collection: z.string(),
    },
    async (args) => {
      logToolUsage('getCollectionMetrics', args);
      const { collection } = args;

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

        let indexUsage: any[] = [];
        try {
          indexUsage = await db.collection(collection).aggregate([
            { $indexStats: {} }
          ]).toArray();
        } catch (e) {
          // $indexStats might not be available
        }

        let recentOps: any[] = [];
        let operationCounts = {
          insert: 0,
          query: 0,
          update: 0,
          delete: 0
        };

        try {
          const profileStatus = await db.admin().command({ profile: -1 });
          if (profileStatus.was > 0) {
            recentOps = await db.collection('system.profile')
              .find({ ns: `${db.databaseName}.${collection}` })
              .sort({ ts: -1 })
              .limit(100)
              .toArray();

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

        const currentOps = await db.admin().command({
          currentOp: true,
          "$all": true,
          ns: `${db.databaseName}.${collection}`
        });

        const activeOperations = currentOps.inprog.filter((op: any) => op.active);

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
              operations: activeOperations.map((op: any) => ({
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
          },
          wiredTiger: stats.wiredTiger || null
        };

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
    'Get slow operations from both profiler and currently running operations',
    {
      minDuration: z.number().min(0).optional(),
      limit: z.number().positive().optional(),
      includeRunning: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getSlowestOperations', args);
      const { minDuration = 100, limit = 10, includeRunning = true } = args;

      try {
        const result: any = {
          profiledOperations: [],
          currentSlowOperations: [],
          profilingStatus: null
        };

        try {
          const profileStatus = await db.admin().command({ profile: -1 });
          result.profilingStatus = profileStatus;

          if (profileStatus.was === 0) {
            try {
              await db.admin().command({ profile: 1, slowms: minDuration });
              result.profilingStatus = { was: 1, slowms: minDuration, enabled: 'temporarily' };
            } catch (e) {
              result.profilingStatus.message = 'Profiling is disabled and could not be enabled automatically';
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
        }

        if (includeRunning) {
          const currentOps = await db.admin().command({
            currentOp: true,
            "$all": true,
            "microsecs_running": { "$gte": minDuration * 1000 }
          });

          result.currentSlowOperations = currentOps.inprog
            .filter((op: any) => op.active && op.microsecs_running >= minDuration * 1000)
            .sort((a: any, b: any) => b.microsecs_running - a.microsecs_running)
            .slice(0, limit)
            .map((op: any) => ({
              operation: op.op,
              namespace: op.ns,
              duration: Math.round(op.microsecs_running / 1000),
              runningTime: op.secs_running,
              active: true,
              opid: op.opid,
              query: sanitizeResponse(op.command || {}),
              client: op.client || 'N/A',
              appName: op.appName || 'N/A',
              waitingForLock: op.waitingForLock || false,
              lockStats: op.lockStats || {},
              killable: op.op !== 'none'
            }));
        }

        const allOperations = [
          ...result.profiledOperations.map((op: any) => ({ ...op, source: 'profiler' })),
          ...result.currentSlowOperations.map((op: any) => ({ ...op, source: 'currentOp' }))
        ].sort((a, b) => b.duration - a.duration);

        const summary = {
          totalSlowOperations: allOperations.length,
          averageDuration: allOperations.length > 0
            ? Math.round(allOperations.reduce((sum, op) => sum + op.duration, 0) / allOperations.length)
            : 0,
          slowestOperation: allOperations[0] || null,
          operationTypes: allOperations.reduce((acc: any, op) => {
            acc[op.operation] = (acc[op.operation] || 0) + 1;
            return acc;
          }, {}),
          namespaces: [...new Set(allOperations.map(op => op.namespace))].slice(0, 10)
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary,
                profilingStatus: result.profilingStatus,
                operations: allOperations.slice(0, limit)
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
