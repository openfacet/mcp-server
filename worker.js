import { createMCPHandler, DOCS_URL, GITHUB_URL } from './core.js';
import { MCP_VERSION } from './mcp-version.js';

const MCP_PATH = '/';
const DEFAULT_ALLOWED_ORIGINS = new Set(['https://openfacet.net', 'https://www.openfacet.net']);

const handler = createMCPHandler({
    fetchFn: async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },
    cache: new Map(),
    logger: () => { },
});

const corsHeaders = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name',
};

function allowedOrigins(env) {
    const configured = `${env?.MCP_ALLOWED_ORIGINS || ''}`.split(',').map((origin) => origin.trim()).filter(Boolean);
    return configured.length ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
}

function requestHeaders(origin, env) {
    return origin && allowedOrigins(env).has(origin)
        ? { ...corsHeaders, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
        : corsHeaders;
}

function headerError(id, message) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code: -32020, message } };
}

function validateHeaders(request, message) {
    const version = request.headers.get('MCP-Protocol-Version');
    const method = request.headers.get('Mcp-Method');
    const name = request.headers.get('Mcp-Name');
    const bodyVersion = message.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
    if (!version || !method || version !== bodyVersion || method !== message.method || (message.method === 'tools/call' && name !== message.params?.name)) {
        return 'MCP request headers do not match the request body';
    }
    return null;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        if (origin && !allowedOrigins(env).has(origin)) {
            return new Response(JSON.stringify(headerError(null, 'Origin is not allowed')), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const headers = requestHeaders(origin, env);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        if (url.pathname === '/health') {
            return new Response(
                JSON.stringify({ status: 'healthy', version: MCP_VERSION }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...headers,
                    },
                }
            );
        }

        if (url.pathname === '/.well-known/mcp.json' && request.method === 'GET') {
            return new Response(JSON.stringify({
                name: "openfacet-diamond-pricing",
                version: "2.0.0",
                description: "OpenFacet diamond pricing with live matrix interpolation and fancy-shape ratio adjustments",
                author: "OpenFacet",
                license: "MIT",
                mcp: {
                    protocolVersion: MCP_VERSION,
                    endpoint: "/",
                    transport: "streamable-http",
                    capabilities: {
                        tools: {
                            listChanged: false
                        }
                    }
                },
                tools: [
                    {
                        name: "get_diamond_price",
                        description: "Price a diamond with live matrix interpolation, special-size adjustments, and fancy-shape ratio ranges",
                        parameters: ["carat", "color", "clarity", "shape", "shape_ratio"]
                    },
                    {
                        name: "get_dcx_index",
                        description: "Retrieve current Diamond Composite Index (DCX) with 24-hour, 7-day, and 30-day trends",
                        parameters: []
                    },
                    {
                        name: "get_market_depth",
                        description: "Fetch comparable observed-offer market depth for a carat weight or the overall inventory",
                        parameters: ["carat"]
                    }
                ],
                documentation: {
                    url: DOCS_URL
                },
                support: {
                    url: GITHUB_URL+ '/issues',
                },
                limits: {
                    cacheExpiry: 86400
                }
            }, null, 2), {
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                }
            });
        }

        // Redirect root GET requests with noindex header
        if (request.method === 'GET' && url.pathname === '/') {
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': DOCS_URL,
                    'X-Robots-Tag': 'noindex',
                    ...headers
                }
            });
        }

        if (request.method !== 'POST' || url.pathname !== MCP_PATH) {
            return new Response('Method Not Allowed', { status: 405, headers });
        }

        try {
            const json = await request.json();
            const mismatch = validateHeaders(request, json);
            if (mismatch) {
                return new Response(JSON.stringify(headerError(json.id, mismatch)), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...headers },
                });
            }
            const response = await handler(json);

            return new Response(JSON.stringify(response), {
                headers: {
                    'Content-Type': 'application/json',
                    'MCP-Protocol-Version': MCP_VERSION,
                    ...headers,
                },
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ error: 'Invalid request', detail: err.message }),
                { status: 400, headers }
            );
        }
    },
};
