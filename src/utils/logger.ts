import fs from 'fs/promises';
import path from 'path';
import { redactString } from './uri-redactor.js';

const LOG_DIR = process.env.LOG_DIR || './logs';
const TOOL_LOG_FILE = path.join(LOG_DIR, 'tool-usage.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');
const ENABLE_LOGGING = process.env.ENABLE_LOGGING === 'true';

let logDirInitialized = false;

async function ensureLogDir(): Promise<boolean> {
  if (logDirInitialized) return true;

  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    logDirInitialized = true;
    return true;
  } catch (error) {
    process.stderr.write(`[mongo-scout-mcp] logging failed: ${error}\n`);
    return false;
  }
}

export function logToolUsage(toolName: string, args: unknown, callerInfo?: string): void {
  if (!ENABLE_LOGGING) return;

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] TOOL: ${toolName}\nArgs: ${redactString(JSON.stringify(args, null, 2))}\nCaller: ${
    callerInfo || 'Unknown'
  }\n---\n`;

  void ensureLogDir().then((ok) => {
    if (!ok) return;
    fs.appendFile(TOOL_LOG_FILE, logEntry).catch((error) => {
      process.stderr.write(`[mongo-scout-mcp] logging failed: ${error}\n`);
    });
  });
}

export function logError(toolName: string, error: unknown, args?: unknown): void {
  const errorMessage = redactString(error instanceof Error ? error.message : String(error));
  const errorStack = error instanceof Error ? error.stack : undefined;

  console.error(`Error in ${toolName}: ${errorMessage}`);

  if (!ENABLE_LOGGING) return;

  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ERROR: ${toolName}\nError: ${errorMessage}\nStack: ${errorStack || 'N/A'}\nArgs: ${redactString(JSON.stringify(
    args,
    null,
    2
  ))}\n---\n`;

  void ensureLogDir().then((ok) => {
    if (!ok) return;
    fs.appendFile(ERROR_LOG_FILE, logEntry).catch((error) => {
      process.stderr.write(`[mongo-scout-mcp] logging failed: ${error}\n`);
    });
  });
}
