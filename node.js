import http from 'http';
import { createMCPHandler } from './core.js';
import { MCP_VERSION } from './mcp-version.js';

const PORT = process.env.PORT || process.argv[2] || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const MCP_PATH = '/';
const allowedOrigins = new Set((process.env.MCP_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean));

const handler = createMCPHandler({
  fetchFn: (url) =>
    fetch(url).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }),
  cache: new Map(),
  logger: console.log,
});

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
};

function originHeaders(origin) {
  return origin && allowedOrigins.has(origin) ? { ...corsHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : corsHeaders;
}

function headerError(id, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code: -32020, message } };
}

function validateHeaders(req, message) {
  const version = req.headers['mcp-protocol-version'];
  const method = req.headers['mcp-method'];
  const name = req.headers['mcp-name'];
  const bodyVersion = message.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? message.params?.protocolVersion;

  if (version && bodyVersion && version !== bodyVersion) {
    return 'MCP request headers do not match the request body';
  }
  if (method && method !== message.method) {
    return 'MCP request headers do not match the request body';
  }
  if (message.method === 'tools/call' && name && name !== message.params?.name) {
    return 'MCP request headers do not match the request body';
  }
  return null;
}

function responseStatus(response) {
  if (response?.error?.code === -32601) return 404;
  if (response?.error?.code === -32602 || response?.error?.code === -32020 || response?.error?.code === -32021 || response?.error?.code === -32022) return 400;
  return 200;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(headerError(null, 'Origin is not allowed')));
    return;
  }
  const headers = originHeaders(origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...headers,
    });
    res.end(JSON.stringify({ status: 'healthy', version: MCP_VERSION }));
    return;
  }

  if (req.url !== MCP_PATH || req.method !== 'POST') {
    res.writeHead(405, { 'Allow': 'POST, OPTIONS', ...headers });
    res.end('Method Not Allowed');
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const message = JSON.parse(body);
      const mismatch = validateHeaders(req, message);
      if (mismatch) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(headerError(message.id, mismatch)));
        return;
      }
      const response = await handler(message);

      res.writeHead(responseStatus(response), {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_VERSION,
        ...headers,
      });
      res.end(JSON.stringify(response));
    } catch (e) {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        ...headers,
      });
      res.end(JSON.stringify({ error: 'Invalid request', detail: e.message }));
    }
  });

  req.on('error', (err) => {
    res.writeHead(500, headers);
    res.end('Server error');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`MCP Server listening on http://${HOST}:${PORT}${MCP_PATH}`);
});
