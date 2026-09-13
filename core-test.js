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
  } else if (url.endsWith('/matrix_melee.json')) {
    // Grouped melee matrix: r=[DEF, GH, IJK], c=[VS+, SI]
    return {
      r: ['DEF', 'GH', 'IJK'],
      c: ['VS+', 'SI'],
      s: [3, 2],
      l: {
        '0.01': [6.769641976852503, 6.338594078203183, 6.413458957167357, 6.22455842927536, 6.22455842927536, 5.971261839790462],
        '0.05': [6.951772164398911, 6.413458957167357, 6.546785410760524, 6.338594078203183, 6.338594078203183, 6.115892125483034],
        '0.10': [7.106606137727303, 6.606650186198215, 6.818924065275521, 6.546785410760524, 6.546785410760524, 6.338594078203183],
        '0.15': [7.2399325913204695, 6.90975328164481, 6.951772164398911, 6.818924065275521, 6.769641976852503, 6.546785410760524],
        '0.20': [7.357556200910353, 7.0317412587631285, 7.106606137727303, 6.951772164398911, 6.93537044601511, 6.664409020350408],
        '0.25': [7.445417556701687, 7.161622002939187, 7.226936018493289, 7.069874128458572, 7.0317412587631285, 6.71901315438526],
        '0.29': [7.445417556701687, 7.161622002939187, 7.226936018493289, 7.069874128458572, 7.0317412587631285, 6.71901315438526]
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
  // Melee round diamond (below 0.3ct)
  tests.push(await handler(request(6, 'tools/call', {
    name: 'get_diamond_price',
    arguments: { carat: 0.05, color: 'F', clarity: 'VS1', shape: 'round' }
  })));
  tests.push(await handler(request(7, 'tools/call', {
    name: 'get_diamond_price',
    arguments: { carat: 0.01, color: 'D', clarity: 'VVS1', shape: 'round' }
  })));
  // Melee with unsupported grade should error gracefully
  tests.push(await handler(request(8, 'tools/call', {
    name: 'get_diamond_price',
    arguments: { carat: 0.05, color: 'M', clarity: 'SI2', shape: 'round' }
  })));
  // Fancy shape below 0.3ct should still error
  tests.push(await handler(request(9, 'tools/call', {
    name: 'get_diamond_price',
    arguments: { carat: 0.05, color: 'D', clarity: 'FL', shape: 'emerald' }
  })));
  tests.push(await handler(request(10, 'tools/call', {
    name: 'get_dcx_index'
  })));
  tests.push(await handler(request(11, 'tools/call', {
    name: 'get_market_depth',
    arguments: { carat: 1.0 }
  })));
  tests.push(await handler(request(12, 'tools/call', {
    name: 'get_market_depth',
    arguments: {}
  })));
  // Test standard MCP client without _meta in params
  tests.push(await handler({
    jsonrpc: '2.0',
    id: 13,
    method: 'initialize',
    params: {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'standard-client', version: '1.0' }
    }
  }));
  tests.push(await handler({
    jsonrpc: '2.0',
    id: 14,
    method: 'tools/call',
    params: {
      name: 'get_dcx_index',
      arguments: {}
    }
  }));

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

  if (!tests[2].result?.tools?.every((tool) => tool.annotations?.openWorldHint === false && tool.annotations?.destructiveHint === false)) {
    throw new Error('Every published tool must be marked non-open-world and non-destructive');
  }

  const preferenceQuote = tests[4].result?.structuredContent;
  if (!preferenceQuote?.preference_driven_ratio || preferenceQuote.price_adjustment_ratio !== 1.7 || preferenceQuote.observed_ratio_range?.max !== 1.7) {
    throw new Error('Preference-driven ratio quote did not report the observed endpoint range');
  }

  // Melee round quote (0.05ct F/VS1) must succeed with a positive per-carat price
  const meleeQuote = tests[5].result?.structuredContent;
  if (!meleeQuote || meleeQuote.shape !== 'round' || meleeQuote.carat !== 0.05 || !Number.isFinite(meleeQuote.per_carat_usd) || meleeQuote.per_carat_usd <= 0) {
    throw new Error('Melee round quote (0.05ct F/VS1) did not return a valid price');
  }

  // Melee at the floor (0.01ct D/VVS1) must succeed
  const meleeFloorQuote = tests[6].result?.structuredContent;
  if (!meleeFloorQuote || meleeFloorQuote.carat !== 0.01 || !Number.isFinite(meleeFloorQuote.per_carat_usd) || meleeFloorQuote.per_carat_usd <= 0) {
    throw new Error('Melee floor quote (0.01ct D/VVS1) did not return a valid price');
  }

  // Melee with unsupported color (M) must surface an error result, not throw
  const meleeUnsupported = tests[7].result;
  if (!meleeUnsupported?.isError) {
    throw new Error('Melee quote with unsupported color M should return an error result');
  }

  // Fancy shape below 0.3ct must surface an error result
  const fancyBelowMin = tests[8].result;
  if (!fancyBelowMin?.isError) {
    throw new Error('Fancy shape below 0.3ct should return an error result');
  }
}

run();
