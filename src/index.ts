import { MongoClient } from 'mongodb';
import { parseArgs } from './config/environment.js';
import { setupServer } from './server/setup.js';
import { stopRateLimiterCleanup } from './utils/rate-limiter.js';
import { redactString } from './utils/uri-redactor.js';

const { uri, dbName, mode } = parseArgs();
const client = new MongoClient(uri);

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    stopRateLimiterCleanup();
    await client.close();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
}

async function main() {
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
    await setupServer(client, dbName, mode);
  } catch (error) {
    console.error('Error:', redactString(error instanceof Error ? error.message : String(error)));
    if (String(error).includes('Authentication failed')) {
      console.error('Authentication failed. Please check your username and password.');
    }
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error('Fatal error:', redactString(error instanceof Error ? error.message : String(error)));
  client.close().catch(console.error);
  process.exit(1);
});
