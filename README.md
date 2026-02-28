# Mongo Scout MCP

Scout your MongoDB databases with AI - A production-ready Model Context Protocol server with built-in safety features, live monitoring, and data quality tools.

## Setup

### Claude Desktop / Claude Code

Add to your MCP config (`~/.config/claude-desktop/config.json` or `~/.claude.json`):

```json
{
  "mcpServers": {
    "mongo-scout": {
      "command": "npx",
      "args": [
        "-y",
        "mongo-scout-mcp",
        "mongodb://localhost:27017",
        "mydb"
      ],
      "type": "stdio"
    }
  }
}
```

### Recommended: Separate Read-Only and Read-Write Instances

The server runs in **read-only mode by default** for safety. For write operations, use a separate instance:

```json
{
  "mcpServers": {
    "mongo-scout-readonly": {
      "command": "npx",
      "args": ["-y", "mongo-scout-mcp", "--read-only", "mongodb://localhost:27017", "mydb"],
      "type": "stdio"
    },
    "mongo-scout-readwrite": {
      "command": "npx",
      "args": ["-y", "mongo-scout-mcp", "--read-write", "mongodb://localhost:27017", "mydb_dev"],
      "type": "stdio"
    }
  }
}
```

This gives you:
- **mongo-scout-readonly**: Safe exploration without risk of data modification
- **mongo-scout-readwrite**: Write operations available when explicitly needed
- Clear separation of capabilities
- Option to point read-write to a development database for extra safety

### Global Install

```bash
npm install -g mongo-scout-mcp
mongo-scout-mcp mongodb://localhost:27017 mydb
```

### Standalone Usage

```bash
# Default read-only mode (safest)
mongo-scout-mcp

# Explicitly enable read-write mode (use with caution)
mongo-scout-mcp --read-write

# With custom URI and database in read-only mode
mongo-scout-mcp mongodb://localhost:27017 mydb

# Read-write mode with custom connection
mongo-scout-mcp --read-write mongodb://localhost:27017 mydb
```

### Command Line Options

```
--read-only          Run server in read-only mode (default)
--read-write         Run server in read-write mode (enables all write operations)
--mode <mode>        Set mode: 'read-only' or 'read-write'
```

## Security

- **Read-only by default** — write operations must be explicitly enabled
- All queries are validated and sanitized
- MongoDB operator injection protection
- Connection string credential redaction in logs
- Rate limiting on all operations
- Response size limits to prevent memory exhaustion

## Available Tools

### Read Operations (both modes)
- **Database**: `listDatabases`, `getDatabaseStats`
- **Collections**: `listCollections`, `getCollectionStats`
- **Documents**: `find`, `aggregate`, `count`, `distinct`
- **Schema**: `inferSchema`

### Write Operations (read-write mode only)
- **Collections**: `createCollection`, `dropCollection`
- **Documents**: `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`, `deleteOne`, `deleteMany`
- **Bulk**: `bulkWrite`, `previewBulkWrite`
- **Preview**: `previewUpdate`, `previewDelete`

### Index Management
- `listIndexes`, `createIndex`, `dropIndex`

### Search & Explain
- `textSearch` — full-text search across collections
- `explainQuery` — query execution plan analysis

### Data Quality & Export
- `findDuplicates` — find duplicate documents based on field combinations
- `cloneCollection` — clone collections with filtering and index copying
- `exportCollection` — export to JSON, JSONL, or CSV
- `findMissingFields` — check for missing required fields
- `findInconsistentTypes` — detect type inconsistencies across documents
- `renameField` — rename fields with dry-run and index migration
- `analyzeQueryPerformance` — query optimization using explain plans
- `findOrphans` — find orphaned references

### Relationship & Validation
- `exploreRelationships` — follow multi-hop relationships and discover dependencies
- `validateDocuments` — run custom validation using MongoDB `$expr` conditions

### Temporal Queries
- `findRecent` — find documents within a time window
- `findInTimeRange` — query between dates with optional grouping
- `detectVolumeAnomalies` — detect unusual activity patterns

### Monitoring
- `getServerStatus`, `runAdminCommand`
- `getConnectionPoolStats`, `getCurrentOperations`
- `getProfilerStats`

### Live Monitoring
- `getLiveMetrics` — real-time performance metrics
- `getHottestCollections` — identify most active collections
- `getCollectionMetrics` — detailed metrics per collection
- `getSlowestOperations` — slow query tracking

## Logging

File logging is **disabled by default**. Enable it with the `ENABLE_LOGGING=true` environment variable:

```json
{
  "mcpServers": {
    "mongo-scout": {
      "command": "npx",
      "args": ["-y", "mongo-scout-mcp", "mongodb://localhost:27017", "mydb"],
      "env": { "ENABLE_LOGGING": "true", "LOG_DIR": "./logs" },
      "type": "stdio"
    }
  }
}
```

When enabled, two log files are created in `LOG_DIR` (defaults to `./logs`):

- **tool-usage.log**: Every tool call with timestamp, tool name, and arguments
- **error.log**: Errors with stack traces and the arguments that caused them

Connection strings and sensitive fields are automatically redacted in all log output.

## ObjectId Format

Both formats accepted for queries:

```json
{ "_id": { "$oid": "507f1f77bcf86cd799439011" } }
{ "_id": "507f1f77bcf86cd799439011" }
```

Responses use Extended JSON format to preserve type information.

## Examples

### Basic Operations
```
find({ collection: "users", query: { age: { $gt: 18 } }, limit: 5, sort: { name: 1 } })
insertOne({ collection: "products", document: { name: "Widget", price: 9.99 } })
inferSchema({ collection: "customers", sampleSize: 50 })
```

### Data Quality
```
findDuplicates({ collection: "users", fields: ["email"], options: { limit: 100 } })
exportCollection({ collection: "products", options: { format: "csv", flatten: true } })
findOrphans({ collection: "orders", localField: "userId", foreignCollection: "users", foreignField: "_id" })
```

### Temporal Queries
```
findRecent({ collection: "logs", timestampField: "createdAt", timeWindow: { value: 24, unit: "hours" } })
detectVolumeAnomalies({ collection: "orders", timestampField: "createdAt", options: { groupBy: "day", lookbackPeriods: 30 } })
```

### Live Monitoring
```
getLiveMetrics({ duration: 30000, interval: 1000 })
getHottestCollections({ limit: 5, sampleDuration: 5000 })
getSlowestOperations({ minDuration: 100, limit: 10 })
```

## Development

```bash
git clone https://github.com/bluwork/mongo-scout-mcp.git
cd mongo-scout-mcp
pnpm install
pnpm build
pnpm test
```

## License

Apache-2.0
