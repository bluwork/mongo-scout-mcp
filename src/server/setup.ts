import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { MongoClient } from 'mongodb';
import { registerAllTools } from '../tools/index.js';

export async function setupServer(client: MongoClient, dbName: string, mode: string): Promise<void> {
  const db = client.db(dbName);

  const server = new McpServer({
    name: `MongoDB MCP (${mode})`,
    version: '1.0.0'
  });

  registerAllTools(server, client, db, dbName, mode);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
