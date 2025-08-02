# MongoDB MCP Server

MongoDB Model Context Protocol server for GitHub Copilot integration.

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Copy the example environment configuration:

   ```
   cp .env.example .env
   ```

3. Configure the `.env` file with your MongoDB connection details.

## Running the server

Build and run:

```
npm run build
npm run start
```

Development mode (no build required):

```
npm run dev
```

Watch mode (auto-restart on file changes):

```
npm run watch
```

## Command Line Usage

```
mongodb-mcp [options] [mongodb-uri] [database-name]
```

### Server Modes

The server supports two modes for enhanced security:

- **Read-Write Mode** (default): All operations available
- **Read-Only Mode**: Only read operations (find, count, aggregate, etc.)

### Command Line Options

```
--read-only          Run server in read-only mode
--read-write         Run server in read-write mode (default)
--mode <mode>        Set mode: 'read-only' or 'read-write'
```

### Examples

```bash
# Default read-write mode
mongodb-mcp

# Read-only mode for safe data exploration
mongodb-mcp --read-only

# With custom URI and database
mongodb-mcp --read-only mongodb://localhost:27017 mydb

# Using explicit mode flag
mongodb-mcp --mode read-only mongodb://username:password@localhost:27017/admin mydb
```

## Environment Variables

- `MONGODB_URI`: MongoDB connection URI
- `MONGODB_DB`: Database name to use
- `SERVER_MODE`: Server mode ('read-only' or 'read-write', default: 'read-write')
- `LOG_DIR`: Directory for log files (default: ./logs)
- `LOG_LEVEL`: Logging level (default: info)
- `TOOL_PREFIX`: Optional prefix for tool names (to debug prefix-related issues)

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

Here are some examples of how Copilot might use these operations:

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
