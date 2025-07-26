import { createMCPHandler, DOCS_URL, GITHUB_URL } from './core.js';
import { MCP_VERSION } from './mcp-version.js';

const MCP_PATH = '/';

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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version',
};

export default {
    async fetch(request) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        if (url.pathname === '/health') {
            return new Response(
                JSON.stringify({ status: 'healthy', version: MCP_VERSION }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        ...corsHeaders,
                    },
                }
            );
        }

        if (url.pathname === '/.well-known/mcp.json' && request.method === 'GET') {
            return new Response(JSON.stringify({
                name: "diamond-pricing-server",
                version: "1.0.0",
                description: "Diamond Pricing MCP server with carat/color/clarity interpolation",
                author: "OpenFacet",
                license: "MIT",
                mcp: {
                    protocolVersion: MCP_VERSION,
                    endpoint: "/",
                    transport: "http",
                    capabilities: {
                        tools: true,
                        logging: true,
                        resources: false,
                        elicitation: false
                    }
                },
                tools: [
                    {
                        name: "get_diamond_price",
                        description: "Price diamond based on carat, color, clarity, and shape",
                        parameters: ["carat", "color", "clarity", "shape"]
                    },
                    {
                        name: "get_dcx_index",
                        description: "Retrieve current Diamond Composite Index (DCX) and 24‑hour change",
                        parameters: []
                    },
                    {
                        name: "get_market_depth",
                        description: "Fetch market depth for a specific carat weight or overall inventory",
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
                    'Access-Control-Allow-Origin': '*'
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
                    ...corsHeaders
                }
            });
        }

        if (request.method !== 'POST' || url.pathname !== MCP_PATH) {
            return new Response('Not Found', { status: 404, headers: corsHeaders });
        }

        try {
            const json = await request.json();
            const response = await handler(json);

            return new Response(JSON.stringify(response), {
                headers: {
                    'Content-Type': 'application/json',
                    'MCP-Protocol-Version': MCP_VERSION,
                    ...corsHeaders,
                },
            });
        } catch (err) {
            return new Response(
                JSON.stringify({ error: 'Invalid request', detail: err.message }),
                { status: 400, headers: corsHeaders }
            );
        }
    },
};
