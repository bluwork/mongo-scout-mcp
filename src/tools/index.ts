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

export function registerAllTools(
  server: McpServer,
  client: MongoClient,
  db: Db,
  dbName: string,
  mode: string
): void {
  registerDatabaseTools(server, client, mode);
  registerCollectionTools(server, db, mode);
  registerDocumentTools(server, db, mode);
  registerSchemaTools(server, db);
  registerIndexManagementTools(server, db, mode);
  registerAdvancedOperations(server, db, mode);
  registerDataQualityTools(server, db, mode);
  registerTemporalTools(server, db, mode);
  registerMonitoringTools(server, client, db, dbName, mode);
  registerLiveMonitoringTools(server, db, mode);
}
