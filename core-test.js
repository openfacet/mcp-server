import { createMCPHandler } from './core.js';

// Minimal fetch stub
const mockFetch = async (url) => {
  if (url.endsWith('/matrix.json')) {
    return {
      r: ['D', 'E'],
      c: ['FL', 'IF'],
      l: {
        '0.3': [6.0, 6.1, 6.2, 6.3],
        '0.4': [6.4, 6.5, 6.6, 6.7]
      },
      s: [2, 2]
    };
  } else if (url.endsWith('/matrix_cushion.json')) {
    return {
      r: ['D', 'E'],
      c: ['FL', 'IF'],
      l: {
        '0.3': [6.0, 6.1, 6.2, 6.3],
        '0.4': [6.4, 6.5, 6.6, 6.7]
      },
      s: [2, 2]
    };
  } else if (url.endsWith('/ratio_models.json')) {
    return {
      shapes: {
        emerald: {
          dataSource: 'round',
          valueMode: 'delta_pct',
          slider: { min: 1.2, center: 1.5, max: 2.0 },
          bands: [{ minCarat: 0.3, maxCarat: 6.0, points: [{ ratio: 1.3, value: 0 }, { ratio: 1.5, value: 10 }, { ratio: 1.7, value: 0 }] }]
        }
      }
    };
  } else if (url.endsWith('/index.json')) {
    return {
      dcx: 5123.45,
      trend: 1.25,
      trend_7d: -0.5,
      trend_30d: 2.75,
      ts: Date.now(),
      specs: [
        { carat: 1.0, color: 'D', clarity: 'IF', per_carat: 5000 },
        { carat: 1.5, color: 'E', clarity: 'FL', per_carat: 5100 }
      ]
    };
  } else if (url.endsWith('/depth.json')) {
    return {
      ts: Date.now(),
      clarity: {
        '1.0': { IF: 10, VVS1: 20 },
      },
      color: {
        '1.0': { D: 15, E: 25 },
      },
      colclar: {
        'D/IF': 12,
        'E/VVS1': 18
      }
    };
  } else {
    throw new Error('Unknown endpoint: ' + url);
  }
};

// Cache stub
const mockCache = new Map();
const logger = console.log;
const handler = createMCPHandler({ fetchFn: mockFetch, cache: mockCache, logger });
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {}
};
const request = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } });

async function run() {
  const tests = [];

  tests.push(await handler(request(1, 'initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'core-test', version: '1.0.0' }
  })));
  tests.push(await handler(request(2, 'server/discover')));
  tests.push(await handler(request(3, 'tools/list')));
  tests.push(await handler(request(4, 'tools/call', {
    name: 'get_diamond_price',
    arguments: { carat: 0.35, color: 'D', clarity: 'FL', shape: 'round' }
  })));
  tests.push(await handler(request(5, 'tools/call', {
    name: 'get_diamond_price',
    arguments: { carat: 0.35, color: 'D', clarity: 'FL', shape: 'emerald', shape_ratio: 1.8 }
  })));
  tests.push(await handler(request(6, 'tools/call', {
    name: 'get_dcx_index'
  })));
  tests.push(await handler(request(7, 'tools/call', {
    name: 'get_market_depth',
    arguments: { carat: 1.0 }
  })));
  tests.push(await handler(request(8, 'tools/call', {
    name: 'get_market_depth',
    arguments: {}
  })));

  tests.forEach((res, i) => {
    const status = res.error ? 'FAIL' : 'PASS';
    console.log(`Test ${i + 1}: ${status}`);
    if (res.error) console.error(res.error);
  });

  const initialization = tests[0].result;
  if (initialization?.protocolVersion !== '2026-07-28' || initialization?.serverInfo?.name !== 'openfacet-diamond-pricing' || initialization?.resultType !== 'complete') {
    throw new Error('Initialize response does not match the MCP result schema');
  }

  const discovery = tests[1].result;
  if (discovery?.supportedVersions?.[0] !== '2026-07-28' || discovery?.resultType !== 'complete' || discovery?._meta?.['io.modelcontextprotocol/serverInfo']?.name !== 'openfacet-diamond-pricing') {
    throw new Error('Discovery response does not match ChatGPT MCP connector expectations');
  }

  if (!tests[2].result?.tools?.every((tool) => tool.outputSchema?.type === 'object' || tool.outputSchema?.oneOf)) {
    throw new Error('Every published tool must define an output schema');
  }

  if (!tests[2].result?.tools?.every((tool) => tool.annotations?.readOnlyHint === true)) {
    throw new Error('Every published tool must be marked read-only');
  }

  const preferenceQuote = tests[4].result?.structuredContent;
  if (!preferenceQuote?.preference_driven_ratio || preferenceQuote.price_adjustment_ratio !== 1.7 || preferenceQuote.observed_ratio_range?.max !== 1.7) {
    throw new Error('Preference-driven ratio quote did not report the observed endpoint range');
  }
}

run();
