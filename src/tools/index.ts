import type { Db, MongoClient } from 'mongodb';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDatabaseTools } from './database.js';
import { registerCollectionTools } from './collection.js';
import { registerDocumentTools } from './document.js';
import { registerSchemaTools } from './schema.js';
import { registerMonitoringTools } from './monitoring.js';
import { registerLiveMonitoringTools } from './live-monitoring.js';
import { registerIndexManagementTools } from './index-management.js';
import { registerAdvancedOperations } from './advanced-operations.js';
import { registerDataQualityTools } from './data-quality.js';
import { registerTemporalTools } from './temporal.js';
import { withConnectionGuard } from '../utils/connection-guard.js';

function wrapServerWithConnectionGuard(server: McpServer): McpServer {
  const originalTool = server.tool.bind(server);

  server.tool = ((...args: unknown[]) => {
    const toolName = args[0] as string;
    const lastIndex = args.length - 1;

    if (typeof args[lastIndex] === 'function') {
      const originalHandler = args[lastIndex] as (...handlerArgs: unknown[]) => Promise<unknown>;
      args[lastIndex] = withConnectionGuard(toolName, originalHandler);
    }

    return (originalTool as (...a: unknown[]) => unknown)(...args);
  }) as typeof server.tool;

  return server;
}

export function registerAllTools(
  server: McpServer,
  client: MongoClient,
  db: Db,
  dbName: string,
  mode: string
): void {
  const guardedServer = wrapServerWithConnectionGuard(server);

  registerDatabaseTools(guardedServer, client, mode);
  registerCollectionTools(guardedServer, db, mode);
  registerDocumentTools(guardedServer, db, mode);
  registerSchemaTools(guardedServer, db);
  registerIndexManagementTools(guardedServer, db, mode);
  registerAdvancedOperations(guardedServer, db, mode);
  registerDataQualityTools(guardedServer, db, mode);
  registerTemporalTools(guardedServer, db, mode);
  registerMonitoringTools(guardedServer, client, db, dbName, mode);
  registerLiveMonitoringTools(guardedServer, db, mode);
}
