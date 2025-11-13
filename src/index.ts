import { MongoClient } from 'mongodb';
import { parseArgs } from './config/environment.js';
import { setupServer } from './server/setup.js';

const { uri, dbName, mode } = parseArgs();
const client = new MongoClient(uri);

let isShuttingDown = false;

async function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    await client.close();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
}

async function main() {
  try {
    await client.connect();
    await setupServer(client, dbName, mode);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    if (String(error).includes('Authentication failed')) {
      console.error('Authentication failed. Please check your username and password.');
    }
    process.exit(1);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error('Fatal error:', error);
  client.close().catch(console.error);
  process.exit(1);
});
