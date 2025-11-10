# MongoDB MCP Server

MongoDB Model Context Protocol server for AI assistants and development tools.

## Setup

1. Install dependencies:

   ```
   pnpm install
   ```

2. Copy the example environment configuration:

   ```
   cp .env.example .env
   ```

3. Configure the `.env` file with your MongoDB connection details.

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
mongodb-mcp [options] [mongodb-uri] [database-name]
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
mongodb-mcp

# Explicitly enable read-write mode (use with caution)
mongodb-mcp --read-write

# With custom URI and database in read-only mode
mongodb-mcp mongodb://localhost:27017 mydb

# Read-write mode with custom connection
mongodb-mcp --read-write mongodb://localhost:27017 mydb
```

### Recommended Setup: Separate MCP Instances

The best practice is to configure **two separate MCP server instances** in your Claude Desktop config:

**~/.config/claude-desktop/config.json** (Linux/Mac) or **%APPDATA%\Claude\config.json** (Windows):

```json
{
  "mcpServers": {
    "mongodb-readonly": {
      "command": "mongodb-mcp",
      "args": ["--read-only"],
      "env": {
        "MONGODB_URI": "mongodb://localhost:27017",
        "MONGODB_DB": "mydb"
      }
    },
    "mongodb-readwrite": {
      "command": "mongodb-mcp",
      "args": ["--read-write"],
      "env": {
        "MONGODB_URI": "mongodb://localhost:27017",
        "MONGODB_DB": "mydb_dev"
      }
    }
  }
}
```

This approach gives you:
- **mongodb-readonly**: Safe exploration without risk of data modification
- **mongodb-readwrite**: Write operations available when explicitly needed
- Clear separation of capabilities - AI assistants will see them as different tools
- Option to point read-write to a development database for extra safety

## Environment Variables

- `MONGODB_URI`: MongoDB connection URI (default: mongodb://localhost:27017)
- `MONGODB_DB`: Database name to use (default: test)
- `SERVER_MODE`: Server mode ('read-only' or 'read-write', **default: 'read-only'**)
- `LOG_DIR`: Directory for log files (default: ./logs)
- `LOG_LEVEL`: Logging level (default: info)
- `TOOL_PREFIX`: Optional prefix for tool names (to debug prefix-related issues)

**Note**: The SERVER_MODE defaults to 'read-only' for safety. To enable write operations, explicitly set it to 'read-write' or use the --read-write command line flag.

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

### Debugging Tool Prefix Issues

If you're experiencing issues like "Tool 9f1*find does not have an implementation registered", this may be due to a prefix mismatch. The MCP server registers tools like "find", but the external AI might be trying to call them with a prefix like "9f1*".

To debug this:

1. Check the `tool-usage.log` to see what tool names are being called
2. Set `TOOL_PREFIX` in your .env file if you identify a consistent prefix

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

The MongoDB MCP server provides these tools:

### Read Operations (available in both modes):
- **Database Operations**: `listDatabases`, `getDatabaseStats`
- **Collection Operations**: `listCollections`, `getCollectionStats` 
- **Document Operations**: `find`, `aggregate`, `count`, `distinct`
- **Schema Operations**: `inferSchema`

### Write Operations (only available in read-write mode):
- **Collection Operations**: `createCollection`, `dropCollection`
- **Document Modification**: `updateOne`, `updateMany`, `replaceOne`, `findOneAndUpdate`
- **Document Creation**: `insertOne`, `insertMany`
- **Document Deletion**: `deleteOne`, `deleteMany`

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

### Live Monitoring Operations (NEW):
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

## License

ISC
