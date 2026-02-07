import type { Db, MongoClient } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logToolUsage, logError } from '../utils/logger.js';
import { checkAdminRateLimit, ADMIN_RATE_LIMIT } from '../utils/rate-limiter.js';
import { sanitizeResponse } from '../utils/sanitize.js';
import { validateAdminCommandParams } from '../utils/admin-command-validator.js';
import type { CurrentOpCommand, CurrentOpResult, ServerStatus, VerbosityLevel } from '../types.js';
import { filterServerStatus, filterDatabaseStats, filterProfilerEntry, excludeZeroMetrics } from '../utils/response-filter.js';

export function registerMonitoringTools(server: McpServer, client: MongoClient, db: Db, dbName: string, mode: string): void {
  const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
    if (writeOperation && mode === 'read-only') {
      return;
    }
    server.tool(toolName, description, schema, handler);
  };

  registerTool(
    'getServerStatus',
    'Get server status and performance metrics. Use includeWiredTiger/includeReplication/includeStorageEngine flags to control detail level for token efficiency.',
    {
      includeHost: z.boolean().optional(),
      includeMetrics: z.array(z.enum(['connections', 'opcounters', 'mem', 'network', 'globalLock', 'asserts'])).optional(),
      includeWiredTiger: z.boolean().optional(),
      includeReplication: z.boolean().optional(),
      includeStorageEngine: z.boolean().optional(),
      excludeZeroMetrics: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getServerStatus', args);
      const {
        includeHost = false,
        includeMetrics,
        includeWiredTiger = false,
        includeReplication = false,
        includeStorageEngine = false,
        excludeZeroMetrics: excludeZero = true
      } = args;

      if (!checkAdminRateLimit('getServerStatus')) {
        return {
          content: [
            {
              type: 'text',
              text: `Rate limit exceeded for getServerStatus. Maximum ${ADMIN_RATE_LIMIT} requests per minute.`,
            },
          ],
        };
      }

      try {
        const serverStatus = await db.admin().command({ serverStatus: 1 }) as ServerStatus;

        let filteredStatus: Partial<ServerStatus> = {
          version: serverStatus.version,
          process: serverStatus.process,
          pid: serverStatus.pid,
          uptime: serverStatus.uptime,
          uptimeMillis: serverStatus.uptimeMillis,
          uptimeEstimate: serverStatus.uptimeEstimate,
          localTime: serverStatus.localTime,
        };

        if (includeHost) {
          filteredStatus.host = serverStatus.host;
        }

        if (!includeMetrics || includeMetrics.length === 0) {
          filteredStatus = {
            ...filteredStatus,
            connections: serverStatus.connections,
            opcounters: serverStatus.opcounters,
            mem: serverStatus.mem,
            network: serverStatus.network,
            globalLock: serverStatus.globalLock,
            asserts: serverStatus.asserts,
          };
        } else {
          type MetricKey = keyof ServerStatus;
          includeMetrics.forEach((metric: string) => {
            const key = metric as MetricKey;
            if (serverStatus[key]) {
              (filteredStatus as Record<string, unknown>)[metric] = serverStatus[key];
            }
          });
        }

        // Filter out DBA-level internals
        let result = filterServerStatus(filteredStatus, {
          includeWiredTiger,
          includeReplication,
          includeStorageEngine
        });

        // Optionally exclude zero metrics
        if (excludeZero) {
          result = excludeZeroMetrics(result as Record<string, unknown>);
        }

        const sanitizedStatus = sanitizeResponse(result);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(sanitizedStatus, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getServerStatus', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting server status: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getDatabaseStats',
    'Get database statistics and storage metrics. Use verbosity to control detail level (summary=most efficient).',
    {
      database: z.string().optional(),
      scale: z.number().positive().optional(),
      indexDetails: z.boolean().optional(),
      verbosity: z.enum(['summary', 'standard', 'full']).optional(),
      excludeZeroMetrics: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getDatabaseStats', args);
      const {
        database = dbName,
        scale = 1,
        indexDetails = false,
        verbosity = 'summary',
        excludeZeroMetrics: excludeZero = true
      } = args;
      try {
        const targetDb = client.db(database);
        const commandOptions: Record<string, unknown> = {
          dbStats: 1,
          scale: scale
        };
        // Only include indexDetails if explicitly set to true (MongoDB 8.0+ deprecated this)
        if (indexDetails === true) {
          commandOptions.indexDetails = true;
        }
        const stats = await targetDb.command(commandOptions);

        // Filter based on verbosity level
        let filtered = filterDatabaseStats(stats as Record<string, unknown>, verbosity as VerbosityLevel);

        // Optionally exclude zero metrics
        if (excludeZero) {
          filtered = excludeZeroMetrics(filtered as Record<string, unknown>);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(filtered, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getDatabaseStats', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting database stats: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'runAdminCommand',
    'Execute arbitrary admin commands on the database',
    {
      command: z.record(z.any()),
      database: z.string().optional(),
      timeout: z.number().positive().optional(),
    },
    async (args) => {
      logToolUsage('runAdminCommand', args);
      const { command, database = 'admin', timeout = 30000 } = args;

      if (!checkAdminRateLimit('runAdminCommand')) {
        return {
          content: [
            {
              type: 'text',
              text: `Rate limit exceeded for runAdminCommand. Maximum ${ADMIN_RATE_LIMIT} requests per minute.`,
            },
          ],
        };
      }

      const allowedCommands = [
        'serverstatus', 'dbstats', 'collstats', 'replsetstatus', 'replsetgetconfig',
        'isMaster', 'ismaster', 'hello', 'ping', 'buildinfo', 'connectionstatus',
        'getcmdlineopts', 'hostinfo', 'listdatabases', 'listcommands', 'profile',
        'currentop', 'top', 'validate', 'explain', 'getlog', 'getparameter',
        'connpoolstats', 'shardingstatus'
      ];

      const commandName = Object.keys(command)[0]?.toLowerCase();
      if (!commandName || !allowedCommands.includes(commandName)) {
        return {
          content: [
            {
              type: 'text',
              text: `Command '${commandName}' is not in the list of allowed commands. Allowed: ${allowedCommands.join(', ')}`,
            },
          ],
        };
      }

      const paramValidation = validateAdminCommandParams(command, commandName);
      if (!paramValidation.valid) {
        return {
          content: [
            {
              type: 'text',
              text: `Command parameter validation failed: ${paramValidation.warnings.join('; ')}`,
            },
          ],
        };
      }

      const maxTimeout = 60000;
      const safeTimeout = Math.min(timeout, maxTimeout);

      try {
        const targetDb = client.db(database);
        const commandWithTimeout = { ...paramValidation.sanitizedCommand, maxTimeMS: safeTimeout };
        const result = await targetDb.admin().command(commandWithTimeout);
        const sanitizedResult = sanitizeResponse(result);

        const responseText = paramValidation.warnings.length > 0
          ? `Warning: ${paramValidation.warnings.join('; ')}\n\n${JSON.stringify(sanitizedResult, null, 2)}`
          : JSON.stringify(sanitizedResult, null, 2);

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      } catch (error) {
        logError('runAdminCommand', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing admin command: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getConnectionPoolStats',
    'Get connection pool statistics and monitoring metrics',
    {},
    async () => {
      logToolUsage('getConnectionPoolStats', {});
      try {
        const serverStatus = await db.admin().command({ serverStatus: 1 });

        const poolStats = {
          totalInUse: serverStatus.connections?.current || 0,
          totalAvailable: serverStatus.connections?.available || 0,
          totalCreated: serverStatus.connections?.totalCreated || 0,
          totalDestroyed: 0,
          poolResetCount: 0,
          connectionMetrics: {
            current: serverStatus.connections?.current || 0,
            available: serverStatus.connections?.available || 0,
            totalCreated: serverStatus.connections?.totalCreated || 0,
            active: serverStatus.connections?.active || 0,
            threaded: serverStatus.connections?.threaded || 0,
          }
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(poolStats, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getConnectionPoolStats', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting connection pool stats: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getCurrentOperations',
    'Get currently running operations on the database',
    {
      allUsers: z.boolean().optional(),
      idleConnections: z.boolean().optional(),
      idleCursors: z.boolean().optional(),
      localOps: z.boolean().optional(),
      truncateOps: z.boolean().optional(),
      excludeSensitiveData: z.boolean().optional(),
    },
    async (args) => {
      logToolUsage('getCurrentOperations', args);
      const {
        allUsers = true,
        idleConnections = false,
        idleCursors = false,
        localOps = false,
        truncateOps = false,
        excludeSensitiveData = true
      } = args;

      if (!checkAdminRateLimit('getCurrentOperations')) {
        return {
          content: [
            {
              type: 'text',
              text: `Rate limit exceeded for getCurrentOperations. Maximum ${ADMIN_RATE_LIMIT} requests per minute.`,
            },
          ],
        };
      }

      try {
        const currentOpCommand: CurrentOpCommand = {
          currentOp: true,
          $all: allUsers,
          $ownOps: !allUsers
        };

        if (idleConnections) currentOpCommand.$ownOps = false;
        if (localOps) currentOpCommand.$local = true;
        if (truncateOps) currentOpCommand.$truncateOps = true;

        const result = await db.admin().command(currentOpCommand) as CurrentOpResult;

        let operations = result.inprog || [];
        if (!idleConnections) {
          operations = operations.filter((op) => op.active || op.op !== 'none');
        }

        if (!idleCursors) {
          operations = operations.filter((op) => !(op as unknown as { cursor?: unknown }).cursor || op.active);
        }

        if (excludeSensitiveData) {
          operations = operations.map((op) => {
            const sanitizedOp = { ...op };

            if (sanitizedOp.command) {
              const sanitizedCommand = sanitizeResponse(sanitizedOp.command);
              sanitizedOp.command = sanitizedCommand as Record<string, unknown>;
            }

            if (sanitizedOp.clientMetadata) {
              delete sanitizedOp.clientMetadata;
            }

            return sanitizedOp;
          });
        }

        const response = {
          inprog: operations,
          ok: result.ok,
          metadata: {
            totalOperations: operations.length,
            activeOperations: operations.filter((op) => op.active).length,
            timestamp: new Date().toISOString()
          }
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getCurrentOperations', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting current operations: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );

  registerTool(
    'getProfilerStats',
    'Get database profiler statistics and slow operation data. Use verbosity to control detail level (summary=most efficient, excludes full query details).',
    {
      database: z.string().optional(),
      limit: z.number().positive().optional(),
      sort: z.record(z.number()).optional(),
      filter: z.record(z.any()).optional(),
      verbosity: z.enum(['summary', 'standard', 'full']).optional(),
    },
    async (args) => {
      logToolUsage('getProfilerStats', args);
      const {
        database = dbName,
        limit = 100,
        sort = { ts: -1 },
        filter = {},
        verbosity = 'summary'
      } = args;
      try {
        const targetDb = client.db(database);

        const profileStatus = await targetDb.command({ profile: -1 });

        if (profileStatus.was === 0) {
          const message = mode === 'read-only'
            ? 'Database profiling is disabled. A database administrator with write access must enable profiling to collect performance data.'
            : 'Database profiling is disabled. Enable profiling to collect performance data.';
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message,
                  profileStatus: profileStatus
                }, null, 2),
              },
            ],
          };
        }

        const profileData = await targetDb
          .collection('system.profile')
          .find(filter)
          .sort(sort)
          .limit(limit)
          .toArray();

        // Filter entries based on verbosity
        const filteredEntries = profileData.map(entry =>
          filterProfilerEntry(entry as Record<string, unknown>, verbosity as VerbosityLevel)
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                profileStatus: profileStatus,
                entries: filteredEntries,
                count: filteredEntries.length
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('getProfilerStats', error, args);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error getting profiler stats: ${errorMessage}`,
            },
          ],
        };
      }
    }
  );
}
