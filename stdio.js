#!/usr/bin/env node

import { createMCPHandler } from './core.js';
import { createInterface } from 'readline';

const handler = createMCPHandler({
  fetchFn: (url) =>
    fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }),
  cache: new Map(),
  logger: (msg) => {
    // Log to stderr so it doesn't interfere with stdio transport
    console.error(`[MCP Server] ${msg}`);
  },
});

// Create readline interface for stdin/stdout
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  crlfDelay: Infinity,
});

// Handle incoming JSON-RPC messages via stdin
rl.on('line', async (line) => {
  try {
    const trimmed = line.trim();
    if (!trimmed) return;

    const message = JSON.parse(trimmed);
    const response = await handler(message);

    // Send response to stdout
    console.log(JSON.stringify(response));
  } catch (error) {
    // Send error response
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
        data: error.message
      }
    };
    console.log(JSON.stringify(errorResponse));
  }
});

// Handle process termination
process.on('SIGINT', () => {
  rl.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  rl.close();
  process.exit(0);
});

// Log startup to stderr
console.error('[MCP Server] Started with stdio transport');