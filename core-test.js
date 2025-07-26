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
  } else if (url.endsWith('/index.json')) {
    return {
      dcx: 5123.45,
      trend: 1.25,
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

async function run() {
  const tests = [];

  tests.push(await handler({ method: 'initialize', id: 1 }));
  tests.push(await handler({ method: 'ping', id: 2 }));
  tests.push(await handler({ method: 'tools/list', id: 3 }));
  tests.push(await handler({
    method: 'tools/call',
    id: 4,
    params: {
      name: 'get_diamond_price',
      arguments: { carat: 0.35, color: 'D', clarity: 'FL', shape: 'round' }
    }
  }));
  tests.push(await handler({ method: 'tools/call', id: 5, params: { name: 'get_dcx_index' } }));
  tests.push(await handler({ method: 'tools/call', id: 6, params: { name: 'get_market_depth', arguments: { carat: 1.0 } } }));

  tests.forEach((res, i) => {
    const status = res.error ? 'FAIL' : 'PASS';
    console.log(`Test ${i + 1}: ${status}`);
    if (res.error) console.error(res.error);
  });
}

run();
