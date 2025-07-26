import http from 'http';
import { createMCPHandler } from './core.js';
import { MCP_VERSION } from './mcp-version.js';

const PORT = process.env.PORT || process.argv[2] || 3000;
const MCP_PATH = '/';

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
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      ...corsHeaders,
    });
    res.end(JSON.stringify({ status: 'healthy', version: MCP_VERSION }));
    return;
  }

  if (req.method !== 'POST' || req.url !== MCP_PATH) {
    res.writeHead(404, corsHeaders);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const message = JSON.parse(body);
      const response = await handler(message);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_VERSION,
        ...corsHeaders,
      });
      res.end(JSON.stringify(response));
    } catch (e) {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        ...corsHeaders,
      });
      res.end(JSON.stringify({ error: 'Invalid request', detail: e.message }));
    }
  });

  req.on('error', (err) => {
    res.writeHead(500, corsHeaders);
    res.end('Server error');
  });
});

server.listen(PORT, () => {
  console.log(`MCP Server listening on http://localhost:${PORT}${MCP_PATH}`);
});
