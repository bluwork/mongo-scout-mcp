import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

// TypeScript interfaces for monitoring data structures
interface ServerStatus {
  host?: string;
  version: string;
  process: string;
  pid: number;
  uptime: number;
  uptimeMillis: number;
  uptimeEstimate: number;
  localTime: Date;
  connections?: {
    current: number;
    available: number;
    totalCreated: number;
    active: number;
    threaded: number;
  };
  opcounters?: {
    insert: number;
    query: number;
    update: number;
    delete: number;
    getmore: number;
    command: number;
  };
  mem?: {
    bits: number;
    resident: number;
    virtual: number;
    mapped: number;
    mappedWithJournal: number;
  };
  network?: {
    bytesIn: number;
    bytesOut: number;
    physicalBytesIn: number;
    physicalBytesOut: number;
    numSlowDNSOperations: number;
    numSlowSSLOperations: number;
    numRequests: number;
  };
  globalLock?: {
    totalTime: number;
    lockTime: number;
    currentQueue: {
      total: number;
      readers: number;
      writers: number;
    };
    activeClients: {
      total: number;
      readers: number;
      writers: number;
    };
  };
  asserts?: {
    regular: number;
    warning: number;
    msg: number;
    user: number;
    rollovers: number;
  };
}

interface DatabaseStats {
  db: string;
  collections: number;
  views: number;
  objects: number;
  avgObjSize: number;
  dataSize: number;
  storageSize: number;
  freeStorageSize: number;
  indexes: number;
  indexSize: number;
  totalSize: number;
  scaleFactor: number;
  fileSize: number;
  nsSizeMB: number;
  fsUsedSize: number;
  fsTotalSize: number;
}

interface ConnectionPoolStats {
  totalInUse: number;
  totalAvailable: number;
  totalCreated: number;
  totalDestroyed: number;
  poolResetCount: number;
  connectionMetrics: {
    current: number;
    available: number;
    totalCreated: number;
    active: number;
    threaded: number;
  };
}

interface CurrentOperation {
  opid: number;
  active: boolean;
  secs_running: number;
  microsecs_running: number;
  op: string;
  ns: string;
  command?: object;
  originatingCommand?: object;
  client: string;
  appName?: string;
  clientMetadata?: object;
  desc: string;
  threadId: string;
  connectionId: number;
}

interface ProfilerEntry {
  op: string;
  ns: string;
  command?: object;
  ts: Date;
  millis: number;
  execStats?: object;
  planSummary?: string;
  keyUpdates?: number;
  writeConflicts?: number;
  numYield?: number;
  locks?: object;
  user?: string;
  appName?: string;
}

interface MongoAdminError {
  code: string;
  message: string;
  details?: object;
  mongoError?: object;
}

// Load environment variables
config();

// Rate limiting for admin operations
const adminOpLimiter = new Map<string, { count: number; resetTime: number }>();
const ADMIN_RATE_LIMIT = 100; // requests per minute
const ADMIN_WINDOW_MS = 60000; // 1 minute

function checkAdminRateLimit(operation: string): boolean {
  const now = Date.now();
  const key = operation;
  const current = adminOpLimiter.get(key) || { count: 0, resetTime: now + ADMIN_WINDOW_MS };
  
  if (now > current.resetTime) {
    current.count = 0;
    current.resetTime = now + ADMIN_WINDOW_MS;
  }
  
  if (current.count >= ADMIN_RATE_LIMIT) {
    return false;
  }
  
  current.count++;
  adminOpLimiter.set(key, current);
  return true;
}

// Security: Sanitize sensitive data from responses
function sanitizeResponse(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = ['connectionString', 'password', 'key', 'secret', 'token'];
  const sanitized = JSON.parse(JSON.stringify(data));
  
  function sanitizeObject(obj: any): void {
    if (!obj || typeof obj !== 'object') return;
    
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        obj[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitizeObject(value);
      }
    }
  }
  
  sanitizeObject(sanitized);
  return sanitized;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  let dbName = process.env.MONGODB_DB || 'test';
  let mode = process.env.SERVER_MODE || 'read-write'; // 'read-only' or 'read-write'
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--read-only') {
      mode = 'read-only';
    } else if (arg === '--read-write') {
      mode = 'read-write';
    } else if (arg === '--mode') {
      mode = args[++i] || mode;
    } else if (!uri || uri === 'mongodb://localhost:27017') {
      uri = arg;
    } else if (!dbName || dbName === 'test') {
      dbName = arg;
    }
  }
  
  return { uri, dbName, mode };
}

const { uri, dbName, mode } = parseArgs();
const client = new MongoClient(uri);

// Setup logging
const LOG_DIR = process.env.LOG_DIR || './logs';
const TOOL_LOG_FILE = path.join(LOG_DIR, 'tool-usage.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Logging functions
function logToolUsage(toolName: string, args: any, callerInfo?: string) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] TOOL CALLED: ${toolName}\nArgs: ${JSON.stringify(args, null, 2)}\nCaller: ${
    callerInfo || 'Unknown'
  }\n-------------------\n`;

  fs.appendFileSync(TOOL_LOG_FILE, logEntry);
  console.log(`Tool called: ${toolName}`);
}

function logError(toolName: string, error: any, args?: any) {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : 'No stack trace';

  const logEntry = `[${timestamp}] ERROR IN TOOL: ${toolName}\nError: ${errorMessage}\nStack: ${errorStack}\nArgs: ${JSON.stringify(
    args,
    null,
    2,
  )}\n-------------------\n`;

  fs.appendFileSync(ERROR_LOG_FILE, logEntry);
  console.error(`Error in tool ${toolName}: ${errorMessage}`);
}

// Validate ObjectId strings
const objectIdSchema = z.string().refine(
  (id) => {
    try {
      return ObjectId.isValid(id);
    } catch {
      return false;
    }
  },
  { message: 'Invalid ObjectId format' },
);

// Helper function to detect if a field likely contains ObjectIds
function isObjectIdField(fieldName: string): boolean {
  // Common patterns for ObjectId fields
  const objectIdPatterns = [
    /^_id$/,           // _id
    /Id$/,             // userId, searchId, postId, etc.
    /^id$/i,           // id (case insensitive)
    /_id$/,            // user_id, search_id, etc.
    /^ref/i,           // ref, reference fields
  ];
  
  return objectIdPatterns.some(pattern => pattern.test(fieldName));
}

// Helper function to preprocess MongoDB queries
function preprocessQuery(query: any): any {
  if (!query || typeof query !== 'object') {
    return query;
  }

  const processed: any = {};

  for (const [key, value] of Object.entries(query)) {
    if (isObjectIdField(key)) {
      // Handle ObjectId fields
      if (typeof value === 'string' && ObjectId.isValid(value)) {
        processed[key] = new ObjectId(value);
      } else if (typeof value === 'object' && value !== null) {
        // Handle query operators on ObjectId fields like { userId: { $in: [...] } }
        processed[key] = preprocessQueryValue(value, key);
      } else {
        processed[key] = value;
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively process nested objects (operators, subdocuments)
      processed[key] = preprocessQuery(value);
    } else if (Array.isArray(value)) {
      // Handle arrays (like in $in operator)
      processed[key] = value.map(item => {
        if (isObjectIdField(key) && typeof item === 'string' && ObjectId.isValid(item)) {
          return new ObjectId(item);
        }
        return typeof item === 'object' ? preprocessQuery(item) : item;
      });
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

// Helper function to preprocess query values (for operators)
function preprocessQueryValue(value: any, fieldName?: string): any {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const processed: any = {};
  const isObjectIdFieldName = fieldName ? isObjectIdField(fieldName) : false;

  for (const [operator, operatorValue] of Object.entries(value)) {
    if (operator.startsWith('$')) {
      // Handle MongoDB operators
      if (Array.isArray(operatorValue)) {
        // For operators like $in, $nin
        processed[operator] = operatorValue.map(item => {
          if (isObjectIdFieldName && typeof item === 'string' && ObjectId.isValid(item)) {
            return new ObjectId(item);
          }
          return item;
        });
      } else if (isObjectIdFieldName && typeof operatorValue === 'string' && ObjectId.isValid(operatorValue)) {
        // For operators like $ne, $gt on ObjectId fields
        processed[operator] = new ObjectId(operatorValue);
      } else {
        processed[operator] = operatorValue;
      }
    } else {
      processed[operator] = operatorValue;
    }
  }

  return processed;
}

// Main function
async function main() {
  try {
    await client.connect();
    console.log('Connected to MongoDB successfully');
    console.log(`Using database: ${dbName}`);
    console.log(`Server mode: ${mode}`);
    const db = client.db(dbName);

    // Create and configure the MCP server
    const server = new McpServer({ 
      name: `MongoDB MCP (${mode})`, 
      version: '1.0.0' 
    });

    // Helper function to register tools based on mode
    const registerTool = (toolName: string, description: string, schema: any, handler: (args?: any) => any, writeOperation = false) => {
      if (writeOperation && mode === 'read-only') {
        // Skip write operations in read-only mode
        return;
      }
      server.tool(toolName, description, schema, handler);
    };

    // Database Operations (always available)
    registerTool('listDatabases', 'List all databases in the MongoDB instance', {}, async () => {
      logToolUsage('listDatabases', {});
      try {
        const databasesList = await client.db().admin().listDatabases();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(databasesList.databases, null, 2),
            },
          ],
        };
      } catch (error) {
        logError('listDatabases', error);
        throw error;
      }
    });

    // Collection Operations
    registerTool('listCollections', 'List all collections in the database', {}, async () => {
      logToolUsage('listCollections', {});
      try {
        const collections = await db.collections();
        return {
          content: [
            {
              type: 'text',
              text: collections.map((c) => c.collectionName).join('\n'),
            },
          ],
        };
      } catch (error) {
        logError('listCollections', error);
        throw error;
      }
    });

    registerTool(
      'createCollection',
      'Create a new collection in the database',
      {
        name: z.string(),
        options: z.record(z.any()).optional(),
      },
      async (args) => {
        logToolUsage('createCollection', args);
        const { name, options = {} } = args;
        try {
          await db.createCollection(name, options);
          return {
            content: [
              {
                type: 'text',
                text: `Collection '${name}' created successfully.`,
              },
            ],
          };
        } catch (error) {
          logError('createCollection', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error creating collection: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'dropCollection',
      'Drop a collection from the database',
      {
        name: z.string(),
      },
      async (args) => {
        logToolUsage('dropCollection', args);
        const { name } = args;
        try {
          const result = await db.collection(name).drop();
          return {
            content: [
              {
                type: 'text',
                text: result ? `Collection '${name}' dropped successfully.` : `Failed to drop collection '${name}'.`,
              },
            ],
          };
        } catch (error) {
          logError('dropCollection', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error dropping collection: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'getCollectionStats',
      'Get statistics for a collection',
      {
        collection: z.string(),
      },
      async (args) => {
        logToolUsage('getCollectionStats', args);
        const { collection } = args;
        try {
          const stats = await db.command({ collStats: collection });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(stats, null, 2),
              },
            ],
          };
        } catch (error) {
          logError('getCollectionStats', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error getting collection stats: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );

    // Document Operations - Enhanced Find
    registerTool(
      'find',
      'Find documents in a collection that match the specified query',
      {
        collection: z.string(),
        query: z.record(z.any()).optional(),
        projection: z.record(z.any()).optional(),
        limit: z.number().positive().optional(),
        skip: z.number().nonnegative().optional(),
        sort: z.record(z.number()).optional(),
      },
      async (args) => {
        logToolUsage('find', args);
        const { collection, query = {}, projection = {}, limit = 10, skip = 0, sort = {} as any } = args;
        try {
          // Preprocess the query to handle ObjectIds and other MongoDB types
          const processedQuery = preprocessQuery(query);
          
          const docs = await db
            .collection(collection)
            .find(processedQuery)
            .project(projection)
            .limit(limit)
            .skip(skip)
            .sort(sort)
            .toArray();

          const total = await db.collection(collection).countDocuments(processedQuery);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    documents: docs,
                    metadata: {
                      total,
                      limit,
                      skip,
                      hasMore: total > skip + docs.length,
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          logError('find', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error executing find: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );

    // Enhanced Aggregation
    registerTool(
      'aggregate',
      'Run an aggregation pipeline on a collection',
      {
        collection: z.string(),
        pipeline: z.array(z.record(z.any())),
        options: z.record(z.any()).optional(),
      },
      async (args) => {
        logToolUsage('aggregate', args);
        const { collection, pipeline, options = {} } = args;
        try {
          const result = await db.collection(collection).aggregate(pipeline, options).toArray();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          logError('aggregate', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error executing aggregation: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );

    // Count Operation
    registerTool(
      'count',
      'Count documents in a collection that match the specified query',
      {
        collection: z.string(),
        query: z.record(z.any()).optional(),
      },
      async (args) => {
        logToolUsage('count', args);
        const { collection, query = {} } = args;
        try {
          const processedQuery = preprocessQuery(query);
          const count = await db.collection(collection).countDocuments(processedQuery);
          return {
            content: [
              {
                type: 'text',
                text: `Found ${count} document(s) matching the query.`,
              },
            ],
          };
        } catch (error) {
          logError('count', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error counting documents: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );

    // Distinct Operation
    registerTool(
      'distinct',
      'Get distinct values for a field across a collection',
      {
        collection: z.string(),
        field: z.string(),
        query: z.record(z.any()).optional(),
      },
      async (args) => {
        logToolUsage('distinct', args);
        const { collection, field, query = {} } = args;
        try {
          const processedQuery = preprocessQuery(query);
          const values = await db.collection(collection).distinct(field, processedQuery);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(values, null, 2),
              },
            ],
          };
        } catch (error) {
          logError('distinct', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error getting distinct values: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );

    // Update Operations
    registerTool(
      'updateOne',
      'Update a single document that matches the filter',
      {
        collection: z.string(),
        filter: z.record(z.any()),
        update: z.record(z.any()),
        options: z.object({
          upsert: z.boolean().optional(),
        }).optional(),
      },
      async (args) => {
        logToolUsage('updateOne', args);
        const { collection, filter, update, options = {} } = args;
        try {
          const processedFilter = preprocessQuery(filter);
          const result = await db.collection(collection).updateOne(processedFilter, update, options);
          
          return {
            content: [
              {
                type: 'text',
                text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedId ? `, Upserted ID: ${result.upsertedId}` : ''}`,
              },
            ],
          };
        } catch (error) {
          logError('updateOne', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error updating document: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'updateMany',
      'Update multiple documents that match the filter',
      {
        collection: z.string(),
        filter: z.record(z.any()),
        update: z.record(z.any()),
        options: z.object({
          upsert: z.boolean().optional(),
        }).optional(),
      },
      async (args) => {
        logToolUsage('updateMany', args);
        const { collection, filter, update, options = {} } = args;
        try {
          const processedFilter = preprocessQuery(filter);
          const result = await db.collection(collection).updateMany(processedFilter, update, options);
          
          return {
            content: [
              {
                type: 'text',
                text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedCount ? `, Upserted: ${result.upsertedCount}` : ''}`,
              },
            ],
          };
        } catch (error) {
          logError('updateMany', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error updating documents: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'replaceOne',
      'Replace a single document that matches the filter',
      {
        collection: z.string(),
        filter: z.record(z.any()),
        replacement: z.record(z.any()),
        options: z.object({
          upsert: z.boolean().optional(),
        }).optional(),
      },
      async (args) => {
        logToolUsage('replaceOne', args);
        const { collection, filter, replacement, options = {} } = args;
        try {
          const processedFilter = preprocessQuery(filter);
          const result = await db.collection(collection).replaceOne(processedFilter, replacement, options);
          
          return {
            content: [
              {
                type: 'text',
                text: `Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}${result.upsertedId ? `, Upserted ID: ${result.upsertedId}` : ''}`,
              },
            ],
          };
        } catch (error) {
          logError('replaceOne', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error replacing document: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'findOneAndUpdate',
      'Find a single document and update it, returning either the original or the updated document',
      {
        collection: z.string(),
        filter: z.record(z.any()),
        update: z.record(z.any()),
        options: z
          .object({
            returnDocument: z.enum(['before', 'after']).optional(),
            upsert: z.boolean().optional(),
          })
          .optional(),
      },
      async (args) => {
        logToolUsage('findOneAndUpdate', args);
        const { collection, filter, update, options = {} } = args;
        try {
          // Preprocess the filter to handle ObjectIds
          const processedFilter = preprocessQuery(filter);
          
          // Convert returnDocument option to MongoDB format
          let mongoOptions: Record<string, any> = {};

          if (options.returnDocument !== undefined) {
            mongoOptions.returnDocument = options.returnDocument === 'after' ? 'after' : 'before';
          }

          if (options.upsert !== undefined) {
            mongoOptions.upsert = options.upsert;
          }

          const result = await db.collection(collection).findOneAndUpdate(processedFilter, update, mongoOptions);

          return {
            content: [
              {
                type: 'text',
                text:
                  result && result.value
                    ? JSON.stringify(result.value, null, 2)
                    : 'No document matched the query. If upsert was used, a new document was inserted.',
              },
            ],
          };
        } catch (error) {
          logError('findOneAndUpdate', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error updating document: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    // Insert Operations
    registerTool(
      'insertOne',
      'Insert a single document into a collection',
      {
        collection: z.string(),
        document: z.record(z.any()),
      },
      async (args) => {
        logToolUsage('insertOne', args);
        const { collection, document } = args;
        try {
          const result = await db.collection(collection).insertOne(document);
          return {
            content: [
              {
                type: 'text',
                text: `Document inserted successfully with _id: ${result.insertedId}`,
              },
            ],
          };
        } catch (error) {
          logError('insertOne', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error inserting document: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'insertMany',
      'Insert multiple documents into a collection',
      {
        collection: z.string(),
        documents: z.array(z.record(z.any())),
        options: z.record(z.any()).optional(),
      },
      async (args) => {
        logToolUsage('insertMany', args);
        const { collection, documents, options = {} } = args;
        try {
          const result = await db.collection(collection).insertMany(documents, options);
          return {
            content: [
              {
                type: 'text',
                text: `${result.insertedCount} document(s) inserted successfully.`,
              },
            ],
          };
        } catch (error) {
          logError('insertMany', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error inserting documents: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    // Delete Operations
    registerTool(
      'deleteOne',
      'Delete a single document that matches the filter',
      {
        collection: z.string(),
        filter: z.record(z.any()),
      },
      async (args) => {
        logToolUsage('deleteOne', args);
        const { collection, filter } = args;
        try {
          const processedFilter = preprocessQuery(filter);
          const result = await db.collection(collection).deleteOne(processedFilter);
          return {
            content: [
              {
                type: 'text',
                text: `${result.deletedCount} document(s) deleted.`,
              },
            ],
          };
        } catch (error) {
          logError('deleteOne', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error deleting document: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    registerTool(
      'deleteMany',
      'Delete multiple documents that match the filter',
      {
        collection: z.string(),
        filter: z.record(z.any()),
      },
      async (args) => {
        logToolUsage('deleteMany', args);
        const { collection, filter } = args;
        try {
          const processedFilter = preprocessQuery(filter);
          const result = await db.collection(collection).deleteMany(processedFilter);
          return {
            content: [
              {
                type: 'text',
                text: `${result.deletedCount} document(s) deleted.`,
              },
            ],
          };
        } catch (error) {
          logError('deleteMany', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error deleting documents: ${errorMessage}`,
              },
            ],
          };
        }
      },
      true // write operation
    );

    // Schema Operations
    registerTool(
      'inferSchema',
      'Infer the schema of a collection from its documents',
      {
        collection: z.string(),
        sampleSize: z.number().positive().optional(),
      },
      async (args) => {
        logToolUsage('inferSchema', args);
        const { collection, sampleSize = 100 } = args;
        try {
          const pipeline = [{ $sample: { size: sampleSize } }, { $limit: sampleSize }];

          const docs = await db.collection(collection).aggregate(pipeline).toArray();

          if (docs.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Collection is empty or no documents found.',
                },
              ],
            };
          }

          // Function to infer schema from documents
          const inferSchema = (documents: any[]) => {
            const schemaMap = new Map<string, Set<string>>();

            // Process each document to identify fields and types
            documents.forEach((doc) => {
              Object.entries(doc).forEach(([key, value]) => {
                if (!schemaMap.has(key)) {
                  schemaMap.set(key, new Set());
                }

                const typeSet = schemaMap.get(key)!;
                if (value === null) {
                  typeSet.add('null');
                } else if (value instanceof ObjectId) {
                  typeSet.add('ObjectId');
                } else if (Array.isArray(value)) {
                  typeSet.add('Array');
                } else if (value instanceof Date) {
                  typeSet.add('Date');
                } else {
                  typeSet.add(typeof value);
                }
              });
            });

            // Convert map to object for display
            const schema: Record<string, string[]> = {};
            schemaMap.forEach((types, field) => {
              schema[field] = Array.from(types);
            });

            return schema;
          };

          const schema = inferSchema(docs);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(schema, null, 2),
              },
            ],
          };
        } catch (error) {
          logError('inferSchema', error, args);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text',
                text: `Error inferring schema: ${errorMessage}`,
              },
            ],
          };
        }
      }
    );

    // Monitoring Operations
    registerTool(
      'getServerStatus',
      'Get comprehensive server status and performance metrics',
      {
        includeHost: z.boolean().optional(),
        includeMetrics: z.array(z.enum(['connections', 'opcounters', 'mem', 'network', 'globalLock', 'asserts'])).optional(),
      },
      async (args) => {
        logToolUsage('getServerStatus', args);
        const { includeHost = false, includeMetrics } = args;
        
        // Rate limiting check
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
          const serverStatus = await db.admin().command({ serverStatus: 1 });
          
          // Filter response based on includeMetrics parameter
          let filteredStatus: any = {
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
            // Include all metrics if none specified
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
            // Include only specified metrics
            includeMetrics.forEach((metric: string) => {
              if (serverStatus[metric]) {
                filteredStatus[metric] = serverStatus[metric];
              }
            });
          }

          // Sanitize response
          const sanitizedStatus = sanitizeResponse(filteredStatus);

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
      'Get comprehensive database statistics and storage metrics',
      {
        database: z.string().optional(),
        scale: z.number().positive().optional(),
        indexDetails: z.boolean().optional(),
      },
      async (args) => {
        logToolUsage('getDatabaseStats', args);
        const { database = dbName, scale = 1, indexDetails = false } = args;
        try {
          const targetDb = client.db(database);
          const stats = await targetDb.command({ 
            dbStats: 1, 
            scale: scale,
            indexDetails: indexDetails 
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(stats, null, 2),
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
        
        // Rate limiting check
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
        
        // Security: Block dangerous commands
        const dangerousCommands = [
          'shutdown', 'fsync', 'dropDatabase', 'eval', 'geoNear',
          'mapReduce', 'copydb', 'clone', 'copydbgetnonce', 'planCacheClear'
        ];
        
        const commandName = Object.keys(command)[0]?.toLowerCase();
        if (dangerousCommands.includes(commandName)) {
          return {
            content: [
              {
                type: 'text',
                text: `Command '${commandName}' is not allowed for security reasons.`,
              },
            ],
          };
        }
        
        // Limit command timeout to prevent resource exhaustion
        const maxTimeout = 60000; // 1 minute max
        const safeTimeout = Math.min(timeout, maxTimeout);
        
        try {
          const targetDb = client.db(database);
          
          // Set timeout for the command if specified
          const commandWithTimeout = { ...command, maxTimeMS: safeTimeout };
          
          const result = await targetDb.admin().command(commandWithTimeout);
          
          // Sanitize response
          const sanitizedResult = sanitizeResponse(result);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(sanitizedResult, null, 2),
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
          
          // Extract connection pool related metrics
          const poolStats = {
            totalInUse: serverStatus.connections?.current || 0,
            totalAvailable: serverStatus.connections?.available || 0,
            totalCreated: serverStatus.connections?.totalCreated || 0,
            totalDestroyed: 0, // Not directly available in serverStatus
            poolResetCount: 0, // Not directly available in serverStatus
            // Additional connection metrics
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
        
        // Rate limiting check
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
          const currentOpOptions: any = {
            $all: allUsers,
            $ownOps: !allUsers
          };

          if (idleConnections) currentOpOptions.$ownOps = false;
          if (localOps) currentOpOptions.$local = true;
          if (truncateOps) currentOpOptions.$truncateOps = true;

          const result = await db.admin().command({ 
            currentOp: currentOpOptions 
          });

          // Filter out idle connections if not requested
          let operations = result.inprog || [];
          if (!idleConnections) {
            operations = operations.filter((op: any) => op.active || op.op !== 'none');
          }

          // Filter out idle cursors if not requested
          if (!idleCursors) {
            operations = operations.filter((op: any) => !op.cursor || op.active);
          }

          // Sanitize sensitive data from operations if requested
          if (excludeSensitiveData) {
            operations = operations.map((op: any) => {
              const sanitizedOp = { ...op };
              
              // Remove or sanitize potentially sensitive command details
              if (sanitizedOp.command) {
                const sanitizedCommand = sanitizeResponse(sanitizedOp.command);
                sanitizedOp.command = sanitizedCommand;
              }
              
              // Remove client connection details that might contain sensitive info
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
              activeOperations: operations.filter((op: any) => op.active).length,
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
      'Get database profiler statistics and slow operation data',
      {
        database: z.string().optional(),
        limit: z.number().positive().optional(),
        sort: z.record(z.number()).optional(),
        filter: z.record(z.any()).optional(),
      },
      async (args) => {
        logToolUsage('getProfilerStats', args);
        const { 
          database = dbName, 
          limit = 100, 
          sort = { ts: -1 }, 
          filter = {} 
        } = args;
        try {
          const targetDb = client.db(database);
          
          // First check if profiling is enabled
          const profileStatus = await targetDb.admin().command({ profile: -1 });
          
          if (profileStatus.was === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'Database profiling is disabled. Enable profiling to collect performance data.',
                    profileStatus: profileStatus
                  }, null, 2),
                },
              ],
            };
          }

          // Query the system.profile collection
          const profileData = await targetDb
            .collection('system.profile')
            .find(filter)
            .sort(sort)
            .limit(limit)
            .toArray();

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  profileStatus: profileStatus,
                  entries: profileData,
                  count: profileData.length
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

    // Live Monitoring Operations
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
        
        // Rate limiting check
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
          
          // Store initial counters
          let previousStatus = await db.admin().command({ serverStatus: 1 });
          
          while (Date.now() - startTime < duration) {
            await new Promise(resolve => setTimeout(resolve, interval));
            
            const currentStatus = await db.admin().command({ serverStatus: 1 });
            
            // Calculate operation rates per second
            const opsPerSec = {
              insert: (currentStatus.opcounters.insert - previousStatus.opcounters.insert) / (interval / 1000),
              query: (currentStatus.opcounters.query - previousStatus.opcounters.query) / (interval / 1000),
              update: (currentStatus.opcounters.update - previousStatus.opcounters.update) / (interval / 1000),
              delete: (currentStatus.opcounters.delete - previousStatus.opcounters.delete) / (interval / 1000),
              command: (currentStatus.opcounters.command - previousStatus.opcounters.command) / (interval / 1000),
              getmore: (currentStatus.opcounters.getmore - previousStatus.opcounters.getmore) / (interval / 1000)
            };
            
            // Calculate network rates
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
          
          // Calculate summary statistics
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
          // Get all collections
          const collections = await db.listCollections().toArray();
          const collectionStats: any[] = [];
          
          // Get initial server status for operation counts
          const initialStatus = await db.admin().command({ serverStatus: 1 });
          
          // Get initial collection stats
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
              // Collection might have been dropped
              continue;
            }
          }
          
          // Monitor current operations for activity
          const operationCounts = new Map<string, number>();
          const startTime = Date.now();
          
          // Sample operations over the duration
          while (Date.now() - startTime < sampleDuration) {
            const currentOps = await db.admin().command({ 
              currentOp: true, 
              "$all": true 
            });
            
            // Count operations per collection
            currentOps.inprog.forEach((op: any) => {
              if (op.ns && op.active) {
                const collName = op.ns.split('.').slice(1).join('.');
                if (collName) {
                  operationCounts.set(collName, (operationCounts.get(collName) || 0) + 1);
                }
              }
            });
            
            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Get final server status
          const finalStatus = await db.admin().command({ serverStatus: 1 });
          const totalOps = finalStatus.opcounters.insert + finalStatus.opcounters.query + 
                          finalStatus.opcounters.update + finalStatus.opcounters.delete - 
                          (initialStatus.opcounters.insert + initialStatus.opcounters.query + 
                           initialStatus.opcounters.update + initialStatus.opcounters.delete);
          
          // Compile collection activity data
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
                readWriteRatio: 'N/A' // Would need profiling data for accurate R/W ratio
              });
            } catch (e) {
              // Collection might have been dropped
              continue;
            }
          }
          
          // Sort by active operations and return top N
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
          // Get collection stats
          const stats = await db.command({ 
            collStats: collection,
            indexDetails: true 
          });
          
          // Get index usage stats
          let indexUsage: any[] = [];
          try {
            indexUsage = await db.collection(collection).aggregate([
              { $indexStats: {} }
            ]).toArray();
          } catch (e) {
            // $indexStats might not be available in all MongoDB versions
          }
          
          // Get recent operations from profiler if enabled
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
              
              // Count operation types
              recentOps.forEach(op => {
                if (op.op === 'insert') operationCounts.insert++;
                else if (op.op === 'query' || op.op === 'find') operationCounts.query++;
                else if (op.op === 'update') operationCounts.update++;
                else if (op.op === 'remove' || op.op === 'delete') operationCounts.delete++;
              });
            }
          } catch (e) {
            // Profiling might not be enabled or accessible
          }
          
          // Monitor current operations for this collection
          const currentOps = await db.admin().command({ 
            currentOp: true,
            "$all": true,
            ns: `${db.databaseName}.${collection}`
          });
          
          const activeOperations = currentOps.inprog.filter((op: any) => op.active);
          
          // Calculate operations per second (if we have profiling data)
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
        minDuration: z.number().positive().optional(),
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
          
          // Check if profiling is enabled and get profiled operations
          try {
            const profileStatus = await db.admin().command({ profile: -1 });
            result.profilingStatus = profileStatus;
            
            if (profileStatus.was === 0) {
              // Try to enable profiling temporarily if not enabled
              try {
                await db.admin().command({ profile: 1, slowms: minDuration });
                result.profilingStatus = { was: 1, slowms: minDuration, enabled: 'temporarily' };
              } catch (e) {
                // User might not have permission to enable profiling
                result.profilingStatus.message = 'Profiling is disabled and could not be enabled automatically';
              }
            }
            
            // Get slow operations from system.profile
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
          
          // Get currently running slow operations
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
          
          // Combine and sort all operations by duration
          const allOperations = [
            ...result.profiledOperations.map((op: any) => ({ ...op, source: 'profiler' })),
            ...result.currentSlowOperations.map((op: any) => ({ ...op, source: 'currentOp' }))
          ].sort((a, b) => b.duration - a.duration);
          
          // Analysis summary
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

    // Connect the server to the transport
    const transport = new StdioServerTransport();
    console.log('Starting MongoDB MCP server...');
    await server.connect(transport);
    console.log('MCP Server running. Waiting for requests...');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    if (String(error).includes('Authentication failed')) {
      console.error('Authentication failed. Please check your username and password.');
    }
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await client.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await client.close();
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  client.close().catch(console.error);
  process.exit(1);
});
