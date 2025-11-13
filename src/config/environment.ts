import { config } from 'dotenv';
import type { AppConfig } from '../types.js';

config();

export function parseArgs(): AppConfig {
  const args = process.argv.slice(2);
  let uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  let dbName = process.env.MONGODB_DB || 'test';
  let mode = process.env.SERVER_MODE || 'read-only';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--read-only') {
      mode = 'read-only';
    } else if (arg === '--read-write') {
      mode = 'read-write';
    } else if (arg === '--mode' && i + 1 < args.length) {
      mode = args[++i];
    } else if (!uri || uri === 'mongodb://localhost:27017') {
      uri = arg;
    } else if (!dbName || dbName === 'test') {
      dbName = arg;
    }
  }

  const logDir = process.env.LOG_DIR || './logs';

  return { uri, dbName, mode, logDir };
}
