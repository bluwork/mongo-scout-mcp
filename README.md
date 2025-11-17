# Mongo Scout MCP

Scout your MongoDB databases with AI - A production-ready Model Context Protocol server with built-in safety features, live monitoring, and data quality tools.

## Setup

Install dependencies:

```
pnpm install
```

## Running the server

Build and run:

```
pnpm build
pnpm start
```

Development mode (no build required):

```
pnpm dev
```

Watch mode (auto-restart on file changes):

```
pnpm watch
```

## Command Line Usage

```
mongo-scout-mcp [options] [mongodb-uri] [database-name]
# or use the shorter alias:
mongo-scout [options] [mongodb-uri] [database-name]
```

### Server Modes

⚠️ **IMPORTANT SECURITY NOTICE**

The server supports two modes with **read-only as the default** for safety:

- **Read-Only Mode** (DEFAULT): Only read operations (find, count, aggregate, monitoring, etc.)
  - Safe for data exploration and analysis
  - No risk of accidental data modification
  - Recommended for most use cases

- **Read-Write Mode**: All operations including insert, update, delete, drop
  - ⚠️ **WARNING**: AI assistants can modify, delete, or drop data
  - ⚠️ **WARNING**: Use only when you explicitly need write operations
  - ⚠️ **WARNING**: Consider using on non-production databases
  - Must be explicitly enabled via command line flag or environment variable

### Command Line Options

```
--read-only          Run server in read-only mode (default)
--read-write         Run server in read-write mode (enables all write operations)
--mode <mode>        Set mode: 'read-only' or 'read-write'
```

### Examples

```bash
# Default read-only mode (safest)
mongo-scout-mcp

# Explicitly enable read-write mode (use with caution)
mongo-scout-mcp --read-write

# With custom URI and database in read-only mode
mongo-scout mongodb://localhost:27017 mydb

# Read-write mode with custom connection
mongo-scout --read-write mongodb://localhost:27017 mydb
```

### Recommended Setup: Separate MCP Instances

The best practice is to configure **two separate MCP server instances** in your Claude Desktop config:

**~/.config/claude-desktop/config.json** (Linux/Mac) or **%APPDATA%\Claude\config.json** (Windows):

```json
{
  "mcpServers": {
    "mongo-scout-readonly": {
      "command": "mongo-scout",
      "args": ["--read-only", "mongodb://localhost:27017", "mydb"]
    },
    "mongo-scout-readwrite": {
      "command": "mongo-scout",
      "args": ["--read-write", "mongodb://localhost:27017", "mydb_dev"]
    }
  }
}
```

This approach gives you:
- **mongo-scout-readonly**: Safe exploration without risk of data modification
- **mongo-scout-readwrite**: Write operations available when explicitly needed
- Clear separation of capabilities - AI assistants will see them as different tools
- Option to point read-write to a development database for extra safety

## Logging and Debugging

The server now includes comprehensive logging to help you debug issues when external AIs interact with your MongoDB through the MCP server.

### Log Files

Two main log files are created in the `LOG_DIR` directory:

1. **tool-usage.log**: Records every tool call with:

   - Timestamp
   - Tool name
   - Arguments used
   - Caller information (when available)

2. **error.log**: Records any errors that occur with:
   - Timestamp
   - Tool name
   - Error message and stack trace
   - Arguments that caused the error

### Viewing Logs in Real-Time

You can monitor logs in real-time while the server is running:

```bash
# For tool usage logs
tail -f logs/tool-usage.log

# For error logs
tail -f logs/error.log
```

This will show you live updates as external AIs interact with your server.

## Available Tools

Mongo Scout MCP provides comprehensive MongoDB tools with a focus on safety and data quality:

### Read Operations (available in both modes):
- **Database Operations**: `listDatabases`, `getDatabaseStats`
- **Collection Operations**: `listCollections`, `getCollectionStats` 
- **Document Operations**: `find`, `aggregate`, `count`, `distinct`
- **Schema Operations**: `inferSchema`

### Write Operations (only available in read-write mode):
- **Collection Operations**: `createCollection`, `dropCollection`, `cloneCollection`
- **Document Modification**: `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`
- **Document Creation**: `insertOne`, `insertMany`
- **Document Deletion**: `deleteOne`, `deleteMany`

### Data Quality & Export Tools (NEW in v1.2.0):
- **Duplicate Detection**: `findDuplicates` - Find duplicate documents based on field combinations
- **Collection Cloning**: `cloneCollection` - Clone collections with filtering and index copying
- **Data Export**: `exportCollection` - Export data to JSON, JSONL, or CSV formats
- **Missing Fields**: `findMissingFields` - Check which documents are missing required fields
- **Type Consistency**: `findInconsistentTypes` - Detect type inconsistencies across documents
- **Field Renaming**: `renameField` - Rename fields with dry-run and index migration support
- **Performance Analysis**: `analyzeQueryPerformance` - Query optimization using explain plans
- **Orphan Detection**: `findOrphans` - Find orphaned references to maintain referential integrity

### Relationship & Validation Tools (NEW in v1.3.0):
- **Relationship Explorer**: `exploreRelationships` - Follow multi-hop relationships and discover document dependencies
- **Custom Validation**: `validateDocuments` - Run custom business logic validation using MongoDB $expr conditions

### Temporal Query Tools (NEW in v1.3.0):
- **Recent Documents**: `findRecent` - Find documents within a time window (minutes, hours, days, weeks)
- **Time Range Queries**: `findInTimeRange` - Query documents between dates with optional grouping
- **Anomaly Detection**: `detectVolumeAnomalies` - Detect unusual activity patterns in document volume over time

### Monitoring Operations (available in both modes):
- **Server Monitoring**: `getServerStatus`, `runAdminCommand`
- **Connection Monitoring**: `getConnectionPoolStats`, `getCurrentOperations`
- **Performance Analysis**: `getProfilerStats`

### Live Monitoring Operations (NEW in v1.1.0):
- **Real-time Metrics**: `getLiveMetrics` - Monitor performance metrics over time with configurable intervals
- **Activity Analysis**: `getHottestCollections` - Identify collections with highest activity
- **Collection Performance**: `getCollectionMetrics` - Get detailed metrics for specific collections
- **Slow Query Analysis**: `getSlowestOperations` - Enhanced slow operation tracking from profiler and current operations

Each tool call is logged, making it easier to debug interactions with external AIs.

### Enhanced Query Processing

The server now includes advanced query preprocessing that:
- Automatically converts string ObjectIds to proper ObjectId objects
- Handles MongoDB query operators correctly (`$in`, `$gt`, `$ne`, etc.)
- Processes nested queries and arrays properly
- Ensures accurate document matching and retrieval

## Examples

Here are some examples of operations you can perform:

### Basic Operations:
```
// List all collections in the current database
listCollections()

// Find documents in a collection
find({ collection: "users", query: { age: { $gt: 18 } }, limit: 5, skip: 10, sort: { name: 1 } })

// Insert a document
insertOne({ collection: "products", document: { name: "Widget", price: 9.99 } })

// Infer schema from a collection
inferSchema({ collection: "customers", sampleSize: 50 })
```

### Live Monitoring Operations:
```
// Monitor real-time metrics for 30 seconds with 1-second intervals
getLiveMetrics({ duration: 30000, interval: 1000 })

// Get top 5 most active collections
getHottestCollections({ limit: 5, sampleDuration: 5000 })

// Get detailed metrics for a specific collection
getCollectionMetrics({ collection: "orders" })

// Find operations taking more than 100ms
getSlowestOperations({ minDuration: 100, limit: 10, includeRunning: true })
```

### Data Quality & Export Operations (NEW):
```
// Find duplicate emails in users collection
findDuplicates({
  collection: "users",
  fields: ["email"],
  options: { limit: 100, includeDocuments: true }
})

// Find duplicates based on multiple fields
findDuplicates({
  collection: "companies",
  fields: ["name", "country"],
  options: { minCount: 3 }
})

// Clone collection with filtering (supports dryRun)
cloneCollection({
  source: "users",
  destination: "users_backup",
  options: {
    filter: { status: "active" },
    includeIndexes: true,
    dryRun: true  // Preview before executing
  }
})

// Export to JSON
exportCollection({
  collection: "products",
  options: {
    format: "json",
    filter: { category: "electronics" },
    limit: 1000,
    pretty: true
  }
})

// Export to CSV with flattened nested objects
exportCollection({
  collection: "orders",
  options: {
    format: "csv",
    projection: { orderNumber: 1, total: 1, customer: 1 },
    flatten: true
  }
})

// Export to JSONL (one document per line, streaming-friendly)
exportCollection({
  collection: "logs",
  options: {
    format: "jsonl",
    filter: { level: "error", date: { $gte: "2025-01-01" } }
  }
})
```

### Relationship Exploration (NEW):
```
// Explore document relationships following foreign keys
exploreRelationships({
  collection: "orders",
  documentId: "507f1f77bcf86cd799439011",
  relationships: [
    {
      localField: "vendorBillId",
      foreignCollection: "vendor_bills",
      foreignField: "_id",
      as: "vendorBill"
    },
    {
      localField: "siteId",
      foreignCollection: "sites",
      foreignField: "_id",
      as: "site"
    }
  ],
  options: {
    depth: 2,           // Follow relationships 2 levels deep
    includeReverse: true // Find docs that reference this one
  }
})

// Find multiple documents with their relationships
exploreRelationships({
  collection: "users",
  filter: { status: "active" },
  relationships: [
    {
      localField: "companyId",
      foreignCollection: "companies",
      foreignField: "_id"
    }
  ],
  options: { limit: 5 }
})
```

### Custom Validation (NEW):
```
// Validate documents using custom MongoDB expressions
validateDocuments({
  collection: "orders",
  rules: [
    {
      name: "total_matches_items",
      condition: {
        $expr: {
          $eq: [
            "$total",
            { $sum: "$lineItems.price" }
          ]
        }
      },
      message: "Order total doesn't match sum of line items",
      severity: "error"
    },
    {
      name: "has_customer_info",
      condition: {
        $expr: {
          $and: [
            { $ne: ["$customerName", null] },
            { $ne: ["$customerEmail", null] }
          ]
        }
      },
      message: "Missing required customer information",
      severity: "warning"
    }
  ],
  options: {
    limit: 1000,
    stopOnFirst: false  // Check all rules even if one fails
  }
})
```

### Temporal Queries (NEW):
```
// Find documents from the last 24 hours
findRecent({
  collection: "logs",
  timestampField: "createdAt",
  timeWindow: {
    value: 24,
    unit: "hours"
  },
  options: {
    filter: { level: "error" },
    limit: 50
  }
})

// Find documents in a specific date range with grouping
findInTimeRange({
  collection: "orders",
  timestampField: "createdAt",
  startDate: "2025-01-01T00:00:00Z",
  endDate: "2025-01-31T23:59:59Z",
  options: {
    groupBy: "day",  // Group results by day
    filter: { status: "completed" }
  }
})

// Detect unusual volume patterns
detectVolumeAnomalies({
  collection: "orders",
  timestampField: "createdAt",
  options: {
    groupBy: "day",
    lookbackPeriods: 30,  // Analyze last 30 days
    threshold: 2.0        // 2 standard deviations
  }
})
```

## License

ISC
