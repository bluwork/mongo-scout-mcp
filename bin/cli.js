#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const helpText = `
MongoDB Model Context Protocol (MCP) Server for GitHub Copilot

Usage:
  mongodb-mcp [options] [mongodb-uri] [database-name]

Options:
  --help, -h         Show this help message
  --version, -v      Show version number
  --read-only        Run server in read-only mode (default)
  --read-write       Run server in read-write mode (enables all write operations)
  --mode <mode>      Set mode: 'read-only' or 'read-write'

Arguments:
  mongodb-uri        MongoDB connection URI (default: mongodb://localhost:27017)
  database-name      Database name to use (default: test)

Examples:
  mongodb-mcp
  mongodb-mcp --read-write mongodb://localhost:27017 mydb
  mongodb-mcp --mode read-only mongodb://localhost:27017 mydb
`;

// Handle command-line options
if (args.includes('--help') || args.includes('-h')) {
  console.log(helpText);
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  // Read version from package.json
  try {
    const packageJsonPath = join(__dirname, '..', 'package.json');
    const packageJson = await import(packageJsonPath, { with: { type: 'json' } });
    console.log(`MongoDB MCP Server v${packageJson.default.version}`);
    process.exit(0);
  } catch (error) {
    console.error(
      'Could not determine version:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

const filteredArgs = args.filter((arg) => !['--help', '-h', '--version', '-v'].includes(arg));

// Launch the actual MCP server
const serverPath = join(__dirname, '..', 'dist', 'index.js');
const nodeProcess = spawnSync('node', [serverPath, ...filteredArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

// Forward the exit code from the child process
process.exit(nodeProcess.status || 0);
