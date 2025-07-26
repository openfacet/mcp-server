import { MCP_VERSION } from './mcp-version.js';

const CACHE_DURATION = 24 * 60 * 60 * 1000;
const API_BASE_URL = 'https://data.openfacet.net/';
const DOCS_URL = 'https://openfacet.net/en/api-docs/#mcp-server';
const GITHUB_URL = 'https://github.com/openfacet/mcp-server';

const GAMMA = 0.1;
const DELTA = 300.0;
const ANCHOR_THRESHOLDS = [0.3, 0.4, 0.5, 0.7, 0.9, 1.0, 1.5, 2.0, 3.0];
const BREAKPOINTS = [0.3, 0.4, 0.5, 0.7, 0.9, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0];

export function createMCPHandler({ fetchFn, cache, logger }) {
  // let initialized = false;

  async function handle(message) {
    if (!message || typeof message !== 'object') {
      return errorResponse(null, -32600, 'Invalid request');
    }

    if (Array.isArray(message)) {
      return errorResponse(null, -32600, 'Batching is not supported');
    }

    const id = message.id ?? null;

    switch (message.method) {
      case 'initialize':
        // initialized = true;
        return successResponse(id, {
          protocolVersion: MCP_VERSION,
          capabilities: { tools: {}, logging: {} },
          serverInfo: { name: 'diamond-pricing-server', version: '1.0.0' },
        });

      case 'initialized':
      case 'ping':
        return successResponse(id, {});

      case 'tools/list':
        // unnecessary for this server.
        // if (!initialized) return errorResponse(id, -32002, 'Server not initialized');
        return successResponse(id, { tools: [tool_getDiamondPrice, tool_getDCXIndex, tool_getMarketDepth] });

      case 'tools/call':
        // unnecessary for this server.
        // if (!initialized) return errorResponse(id, -32002, 'Server not initialized');

        const { name, arguments: args } = message.params ?? {};
        if (!name) return errorResponse(id, -32602, 'Missing tool name');

        try {
          let result;
          switch (name) {
            case 'get_diamond_price':
              result = await getDiamondPrice(args);
              break;
            case 'get_dcx_index':
              result = await getDCXIndex();
              break;
            case 'get_market_depth':
              result = await getMarketDepth(args);
              break;
            default:
              return errorResponse(id, -32601, `Unknown tool: ${name}`);
          }
          return successResponse(id, result);
        } catch (err) {
          logger?.(err);
          return errorResponse(id, -32000, err.message);
        }

      case 'logging/setLevel':
        return successResponse(id, {});

      default:
        return errorResponse(id, -32601, `Unknown method: ${message.method}`);
    }
  }

  function errorResponse(id, code, message, data) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data ? { data } : {}) },
    };
  }

  function successResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  async function getCached(key, fetchFnInternal) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_DURATION) return entry.data;
    const data = await fetchFnInternal();
    cache.set(key, { data, ts: Date.now() });
    return data;
  }

  async function getDiamondPrice({ carat, color, clarity, shape = 'round' }) {
    if (typeof carat !== 'number' || carat < 0.3 || carat > 6.0)
      throw new Error('Carat must be a number between 0.3 and 6.0');

    const matrixKey = `matrix_${shape}`;
    const matrixData = await getCached(matrixKey, async () => {
      const endpoint = shape === 'cushion' ? '/matrix_cushion.json' : '/matrix.json';
      return fetchFn(`${API_BASE_URL}${endpoint}`);
    });

    const colorIndex = matrixData.r.indexOf(color);
    const clarityIndex = matrixData.c.indexOf(clarity);
    if (colorIndex === -1) throw new Error(`Invalid color: ${color}`);
    if (clarityIndex === -1) throw new Error(`Invalid clarity: ${clarity}`);

    const perCarat = interpolatePrice(
      carat,
      matrixData.l,
      matrixData.s,
      colorIndex,
      clarityIndex
    );

    const total = perCarat * carat;

    return {
      content: [
        {
          type: 'text',
          text:
            `💎 **Diamond Price Quote**\n\n` +
            `**Specifications:**\n` +
            `• Carat: ${carat}ct\n` +
            `• Color: ${color}\n` +
            `• Clarity: ${clarity}\n` +
            `• Shape: ${shape}\n\n` +
            `**Pricing:**\n` +
            `• Per Carat: $${perCarat.toLocaleString()}\n` +
            `• Total Price: $${total.toLocaleString()}\n\n` +
            `*Prices from OpenFacet.net API*`,
        },
      ],
      _meta: {
        timestamp: new Date().toISOString(),
        source: 'OpenFacet.net API',
      },
    };
  }

  function interpolatePrice(carat, logPrices, shape, colorIndex, clarityIndex) {
    let fromIdx = BREAKPOINTS.findIndex((v, i) => carat >= v && carat < BREAKPOINTS[i + 1]);
    if (fromIdx === -1) fromIdx = BREAKPOINTS.length - 2;

    const from = BREAKPOINTS[fromIdx];
    const to = BREAKPOINTS[fromIdx + 1];
    const log1 = logPrices[from.toFixed(1)];
    const log2 = logPrices[to.toFixed(1)];

    if (!log1 || !log2) throw new Error(`Missing price data around ${carat}ct`);

    const flatIndex = colorIndex * shape[1] + clarityIndex;
    const v1 = log1[flatIndex];
    const v2 = log2[flatIndex];

    const λ = (carat - from) / (to - from);
    const base = Math.exp((1 - λ) * v1 + λ * v2);
    const next = Math.exp(v2);

    let boost = 0;
    for (const t of ANCHOR_THRESHOLDS) {
      const d = t - carat;
      if (d > 0 && d < 0.03 && next > base) {
        const raw = GAMMA * Math.exp(-DELTA * d);
        const maxBoost = (next / base - 1.0) * 0.8;
        boost = Math.min(raw, maxBoost);
        break;
      }
    }

    return Math.round(base * (1 + boost));
  }

  async function getDCXIndex() {
    const data = await getCached('dcx_index', () => fetchFn(`${API_BASE_URL}/index.json`));
    const trendIcon = data.trend > 0 ? '📈' : data.trend < 0 ? '📉' : '➡️';

    return {
      content: [
        {
          type: 'text',
          text:
            `📊 **Diamond Composite Index (DCX)**\n\n` +
            `**Current Index:** $${data.dcx.toLocaleString()}/carat\n` +
            `**24h Change:** ${trendIcon} ${data.trend > 0 ? '+' : ''}${data.trend.toFixed(2)}%\n\n` +
            `**Market Basket:**\n` +
            data.specs
              .map((s) => `• ${s.carat}ct ${s.color} ${s.clarity}: $${s.per_carat.toLocaleString()}/ct`)
              .join('\n') +
            `\n\n*Last Updated: ${new Date(data.ts).toLocaleString()}*`,
        },
      ],
      _meta: {
        timestamp: data.ts,
        source: 'OpenFacet DCX Index',
        dcx_value: data.dcx,
        trend_percent: data.trend,
      },
    };
  }

  async function getMarketDepth({ carat } = {}) {
    const data = await getCached('market_depth', () => fetchFn(`${API_BASE_URL}/depth.json`));
    let out = '📈 **Diamond Market Depth**\n\n';

    if (carat) {
      const key = carat.toFixed(1);
      const clarity = data.clarity[key] || {};
      const color = data.color[key] || {};

      out += `**${carat}ct Diamonds:**\n\n`;

      if (Object.keys(clarity).length > 0) {
        out += `**By Clarity:**\n`;
        for (const [k, v] of Object.entries(clarity).sort((a, b) => b[1] - a[1]))
          out += `• ${k}: ${v.toLocaleString()} stones\n`;
      }

      if (Object.keys(color).length > 0) {
        out += `\n**By Color:**\n`;
        for (const [k, v] of Object.entries(color).sort((a, b) => b[1] - a[1]))
          out += `• ${k}: ${v.toLocaleString()} stones\n`;
      }

      if (!Object.keys(clarity).length && !Object.keys(color).length)
        out += `No inventory data for ${carat}ct diamonds.`;
    } else {
      const all = Object.keys(data.clarity).map(parseFloat).sort((a, b) => a - b);
      out += `**Available Carats:** ${all.length} options\nRange: ${all[0]}ct – ${all[all.length - 1]}ct\n\n`;

      const topCombos = Object.entries(data.colclar).sort((a, b) => b[1] - a[1]).slice(0, 10);
      out += `**Top 10 Color/Clarity Combinations:**\n`;
      for (const [combo, count] of topCombos)
        out += `• ${combo}: ${count.toLocaleString()} stones\n`;
    }

    out += `\n*Market snapshot: ${new Date(data.ts).toLocaleString()}*`;

    return {
      content: [{ type: 'text', text: out }],
      _meta: {
        timestamp: data.ts,
        source: 'OpenFacet Market Depth',
        ...(carat && { carat_filter: carat }),
      },
    };
  }

  const tool_getDiamondPrice = {
    name: 'get_diamond_price',
    title: 'Get Diamond Price',
    description: 'Get diamond price using interpolation',
    inputSchema: {
      type: 'object',
      properties: {
        carat: { type: 'number', minimum: 0.3, maximum: 6.0 },
        color: { type: 'string', enum: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'] },
        clarity: { type: 'string', enum: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'] },
        shape: { type: 'string', enum: ['round', 'cushion'], default: 'round' },
      },
      required: ['carat', 'color', 'clarity'],
    },
  };

  const tool_getDCXIndex = {
    name: 'get_dcx_index',
    title: 'Get DCX Index',
    description: 'Get latest Diamond Composite Index',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  };

  const tool_getMarketDepth = {
    name: 'get_market_depth',
    title: 'Get Market Depth',
    description: 'Get market inventory depth',
    inputSchema: {
      type: 'object',
      properties: {
        carat: { type: 'number', minimum: 0.3, maximum: 6.0 },
      },
      additionalProperties: false,
    },
  };

  return handle;
}
