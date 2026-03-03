# Mongo Scout MCP

Scout your MongoDB databases with AI - A production-ready Model Context Protocol server with built-in safety features, live monitoring, and data quality tools.

[![npm](https://img.shields.io/npm/v/mongo-scout-mcp)](https://www.npmjs.com/package/mongo-scout-mcp) [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

## What You Get

You ask:

> *"Anything unusual happening with order volume this month?"*

Mongo Scout returns:

---

### Volume Analysis: `orders`

**Statistics** (last 30 days)
| Metric | Value |
|--------|-------|
| Daily Average | 2,847 documents |
| Standard Deviation | 412 |
| Min / Max | 1,923 / 3,601 |

**Anomalies Detected**
- **Feb 14** — 5,892 documents (+7.4σ) — Valentine's Day spike
- **Feb 22** — 847 documents (-4.9σ) — Payment gateway outage window
- **Mar 1** — 4,201 documents (+3.3σ) — Month-start subscription renewals

**Recommendations**
- Feb 22 drop warrants investigation — possible data loss during outage
- Consider auto-scaling rules for predictable spikes (month boundaries, holidays)
- Set up alerts for volumes exceeding ±3σ from rolling average

---

That's `detectVolumeAnomalies` — one of 50 tools covering exploration, querying, diagnostics, monitoring, data quality, and safe writes.

## Quick Start

### Claude Code

```bash
claude mcp add mongo-scout -- npx -y mongo-scout-mcp mongodb://localhost:27017 mydb
```

Then ask: *"What collections do I have and what do their schemas look like?"*

<details>
<summary>Claude Desktop</summary>

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mongo-scout": {
      "command": "npx",
      "args": ["-y", "mongo-scout-mcp", "mongodb://localhost:27017", "mydb"],
      "type": "stdio"
    }
  }
}
```

</details>

<details>
<summary>Cursor / VS Code</summary>

Add to your MCP settings:

```json
{
  "mongo-scout": {
    "command": "npx",
    "args": ["-y", "mongo-scout-mcp", "mongodb://localhost:27017", "mydb"]
  }
}
```

</details>

<details>
<summary>Read-Only vs Read-Write</summary>

The server runs in **read-only mode by default**. For write operations, run a separate instance:

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

- **mongo-scout-readonly**: Safe exploration, no risk of data modification
- **mongo-scout-readwrite**: Write operations when explicitly needed

</details>

## Tools

### Explore — understand your database

- `listDatabases` — all databases in the instance
- `getDatabaseStats` — storage and performance statistics
- `listCollections` — collections in the current database
- `getCollectionStats` — size, document count, index details
- `inferSchema` — schema inference from sampled documents

### Query — find and analyze documents

- `find` — query documents with filtering, sorting, projection
- `aggregate` — run aggregation pipelines
- `count` — count documents matching a query
- `distinct` — unique values for a field
- `textSearch` — full-text search across indexed fields
- `explainQuery` — query execution plan analysis

### Diagnose — spot problems early

- `detectVolumeAnomalies` — unusual patterns in document volume
- `analyzeQueryPerformance` — query optimization using explain plans

### Monitor — watch it live

- `getServerStatus` — server performance metrics
- `getCurrentOperations` — currently running operations
- `getConnectionPoolStats` — connection pool health
- `getProfilerStats` — profiler data and slow operations
- `getLiveMetrics` — real-time metrics with continuous updates
- `getHottestCollections` — collections with highest activity
- `getCollectionMetrics` — detailed per-collection metrics
- `getSlowestOperations` — slow query tracking
- `runAdminCommand` — execute admin commands

### Data Quality — trust your data

- `findDuplicates` — duplicate documents by field combination
- `findOrphans` — orphaned references across collections
- `findMissingFields` — documents missing required fields
- `findInconsistentTypes` — type inconsistencies across documents
- `validateDocuments` — custom validation with MongoDB `$expr`

### Relationships — follow the references

- `exploreRelationships` — multi-hop relationship traversal

### Time Series — temporal analysis

- `findRecent` — documents within a time window
- `findInTimeRange` — date range queries with optional grouping

### Indexes — manage your indexes

- `listIndexes` — all indexes for a collection
- `createIndex` — create new indexes
- `dropIndex` — remove indexes

### Export — get data out

- `exportCollection` — JSON, JSONL, or CSV
- `cloneCollection` — clone with filtering and index copying

### Preview — dry-run before changing anything

- `previewUpdate` / `previewDelete` — see what would change before committing
- `previewBulkWrite` — preview bulk operations

### Write (read-write only) — safe modifications

- `insertOne` / `insertMany` — insert documents
- `updateOne` / `updateMany` — update with dryRun and maxDocuments limits
- `replaceOne` — replace a single document
- `findOneAndUpdate` — find and update atomically
- `deleteOne` / `deleteMany` — delete with dryRun and maxDocuments limits
- `bulkWrite` — multiple write operations in one call
- `renameField` — rename fields with dry-run and index migration
- `createCollection` / `dropCollection` — collection management

## Security

- **Read-only by default** — write operations must be explicitly enabled
- All queries are validated and sanitized
- MongoDB operator injection protection
- Connection string credential redaction in logs
- Rate limiting on all operations
- Response size limits to prevent memory exhaustion

## Examples

> *"What collections do I have and what's the schema of users?"*

```
listCollections()
inferSchema({ collection: "users", sampleSize: 50 })
```

> *"Find duplicate emails in the users collection."*

```
findDuplicates({ collection: "users", fields: ["email"], options: { limit: 100 } })
```

> *"Show me order volume anomalies over the last month."*

```
detectVolumeAnomalies({ collection: "orders", timestampField: "createdAt", options: { groupBy: "day", lookbackPeriods: 30 } })
```

> *"What's happening on the server right now?"*

```
getServerStatus()
getCurrentOperations()
getHottestCollections({ limit: 5, sampleDuration: 5000 })
```

> *"Find orders that reference deleted users."*

```
findOrphans({ collection: "orders", localField: "userId", foreignCollection: "users", foreignField: "_id" })
```

> *"Export the products collection as CSV."*

```
exportCollection({ collection: "products", options: { format: "csv", flatten: true } })
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LOGGING` | `false` | Enable file logging |
| `LOG_DIR` | `./logs` | Log file directory |

CLI flags: `--read-only` (default), `--read-write`, `--mode <mode>`

## Logging

File logging is disabled by default. Set `ENABLE_LOGGING=true` to enable. Two log files are created in `LOG_DIR`:

- **tool-usage.log** — every tool call with timestamp, name, and arguments
- **error.log** — errors with stack traces

Connection strings are automatically redacted in all output.

## ObjectId Format

Both formats accepted:

```json
{ "_id": { "$oid": "507f1f77bcf86cd799439011" } }
{ "_id": "507f1f77bcf86cd799439011" }
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
