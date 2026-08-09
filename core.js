import { MCP_VERSION } from './mcp-version.js';

const CACHE_DURATION = 24 * 60 * 60 * 1000;
const API_BASE_URL = 'https://data.openfacet.net';
export const DOCS_URL = 'https://openfacet.net/en/api-docs/#mcp-server';
export const GITHUB_URL = 'https://github.com/openfacet/mcp-server';

const BREAKPOINTS = [0.3, 0.4, 0.5, 0.7, 0.9, 1, 1.5, 2, 3, 4, 5, 6];
const ANCHORS = [0.3, 0.4, 0.5, 0.7, 0.9, 1, 1.5, 2, 3];
const SPECIAL_TARGETS = [0.5, 0.7, 1, 1.5, 2, 3, 5];
const DISCOUNTS = [0.12, 0.06, 0.03];
const SHAPES = ['round', 'cushion', 'radiant', 'emerald', 'oval', 'pear', 'marquise', 'heart'];
const SERVER_INFO = { name: 'openfacet-diamond-pricing', version: '2.0.0' };

export function createMCPHandler({ fetchFn, cache, logger }) {
  async function handle(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') return error(null, -32600, 'Invalid JSON-RPC request');
    const id = message.id;
    if (id === null || (id !== undefined && typeof id !== 'string' && typeof id !== 'number')) return error(null, -32600, 'Request id must be a string or number');
    const metadataError = validateMetadata(message);
    if (metadataError) return error(id ?? null, metadataError.code, metadataError.message, metadataError.data);
    if (id === undefined) return null;

    switch (message.method) {
      case 'initialize':
        return success(id, { protocolVersion: MCP_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
      case 'server/discover':
        return success(id, { supportedVersions: [MCP_VERSION], capabilities: { tools: { listChanged: false } }, ttlMs: CACHE_DURATION, cacheScope: 'public' });
      case 'tools/list':
        return success(id, { tools: [toolGetDiamondPrice, toolGetDCXIndex, toolGetMarketDepth], ttlMs: CACHE_DURATION, cacheScope: 'public' });
      case 'tools/call':
        return callTool(id, message.params);
      default:
        return error(id, -32601, `Unknown method: ${message.method}`);
    }
  }

  function validateMetadata(message) {
    const meta = message.params?._meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { code: -32602, message: 'Missing request metadata' };
    const version = meta['io.modelcontextprotocol/protocolVersion'];
    const capabilities = meta['io.modelcontextprotocol/clientCapabilities'];
    if (typeof version !== 'string' || !capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return { code: -32602, message: 'Request metadata must include protocolVersion and clientCapabilities' };
    if (version !== MCP_VERSION) return { code: -32022, message: 'Unsupported protocol version', data: { requested: version, supported: [MCP_VERSION] } };
    return null;
  }

  async function callTool(id, params = {}) {
    const { name, arguments: args = {} } = params;
    if (typeof name !== 'string') return error(id, -32602, 'Missing tool name');
    if (!args || typeof args !== 'object' || Array.isArray(args)) return error(id, -32602, 'Tool arguments must be an object');
    try {
      if (name === 'get_diamond_price') return success(id, await getDiamondPrice(args));
      if (name === 'get_dcx_index') return success(id, await getDCXIndex());
      if (name === 'get_market_depth') return success(id, await getMarketDepth(args));
      return error(id, -32602, `Unknown tool: ${name}`);
    } catch (exception) {
      logger?.(exception);
      return success(id, { content: [{ type: 'text', text: exception.message }], isError: true });
    }
  }

  function error(id, code, message, data) { return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }; }
  function success(id, result) { return { jsonrpc: '2.0', id, result: { resultType: 'complete', ...result, _meta: { ...result._meta, 'io.modelcontextprotocol/serverInfo': SERVER_INFO } } }; }
  async function getCached(key, load) { const entry = cache.get(key); if (entry && Date.now() - entry.ts < CACHE_DURATION) return entry.data; const data = await load(); cache.set(key, { data, ts: Date.now() }); return data; }

  async function getDiamondPrice({ carat, color, clarity, shape = 'round', shape_ratio: suppliedRatio }) {
    if (!Number.isFinite(carat) || carat < 0.3 || carat > 6) throw new Error('Carat must be a number between 0.3 and 6.0');
    const normalizedShape = `${shape}`.toLowerCase();
    if (!SHAPES.includes(normalizedShape)) throw new Error(`Invalid shape: ${shape}. Choose one of: ${SHAPES.join(', ')}`);
    const [round, cushion, ratioModels] = await Promise.all([
      getCached('matrix_round', () => fetchFn(`${API_BASE_URL}/matrix.json`)),
      getCached('matrix_cushion', () => fetchFn(`${API_BASE_URL}/matrix_cushion.json`)),
      getCached('ratio_models', () => fetchFn(`${API_BASE_URL}/ratio_models.json`)),
    ]);
    const model = ratioModels?.shapes?.[normalizedShape] || null;
    const matrix = model?.dataSource === 'cushion' || normalizedShape === 'cushion' ? cushion : round;
    const normalizedColor = `${color}`.toUpperCase();
    const normalizedClarity = `${clarity}`.toUpperCase();
    const colorIndex = matrix.r.indexOf(normalizedColor);
    const clarityIndex = matrix.c.indexOf(normalizedClarity);
    if (colorIndex < 0) throw new Error(`Invalid color: ${color}`);
    if (clarityIndex < 0) throw new Error(`Invalid clarity: ${clarity}`);
    const ratio = suppliedRatio ?? model?.slider?.center ?? 1;
    if (!Number.isFinite(ratio) || (model?.slider && (ratio < model.slider.min || ratio > model.slider.max))) throw new Error(`Shape ratio must be a number${model?.slider ? ` between ${model.slider.min} and ${model.slider.max}` : ''}`);
    const ratioRange = ratioRanges(model, carat, ratio);
    const basePerCarat = interpolatePrice(carat, matrix.l, matrix.c.length, colorIndex, clarityIndex);
    const multiplier = ratioMultiplier(model, carat, ratio);
    const perCarat = Math.round(basePerCarat * multiplier);
    const total = Math.round(perCarat * carat);
    const preferenceDriven = isPreferenceDrivenRatio(model, carat, ratio);
    const trackingUrl = trackingUrlFor(normalizedShape, normalizedColor, normalizedClarity, carat, ratio, total, perCarat);
    const structuredContent = { shape: normalizedShape, carat, color: normalizedColor, clarity: normalizedClarity, shape_ratio: ratio, supported_ratio_range: ratioRange.supported, observed_ratio_range: ratioRange.observed, price_adjustment_ratio: ratioRange.applied, per_carat_usd: perCarat, total_usd: total, ratio_multiplier: multiplier, preference_driven_ratio: preferenceDriven, tracking_url: trackingUrl };
    const ratioText = model?.slider ? `\n- L/W ratio: ${ratio.toFixed(2)} (${multiplier.toFixed(3)}x)\n- Supported ratio range: ${formatRatioRange(ratioRange.supported)}\n- Observed pricing range at ${carat.toFixed(2)} ct: ${formatRatioRange(ratioRange.observed)}` : '';
    const preferenceText = preferenceDriven ? `\n\nAt these ratios, pricing tends to be more preference-driven. The price adjustment is held at the nearest observed ratio (${ratioRange.applied.toFixed(2)}).` : '';
    return { content: [{ type: 'text', text: `OpenFacet diamond price quote\n\n- ${carat.toFixed(2)} ct ${normalizedShape}\n- Color: ${normalizedColor}\n- Clarity: ${normalizedClarity}${ratioText}\n- Per carat: $${perCarat.toLocaleString()}\n- Total: $${total.toLocaleString()}${preferenceText}\n\nTrack this diamond: ${trackingUrl}` }], structuredContent, _meta: { timestamp: new Date().toISOString(), source: 'openfacet.net' } };
  }

  function interpolatePrice(carat, logPrices, clarityCount, colorIndex, clarityIndex) {
    let band = BREAKPOINTS.findIndex((point, index) => carat >= point && carat < BREAKPOINTS[index + 1]);
    if (band === -1) band = BREAKPOINTS.length - 2;
    const from = BREAKPOINTS[band]; const to = BREAKPOINTS[band + 1];
    const first = logPrices[from.toFixed(1)]; const second = logPrices[to.toFixed(1)];
    const valueIndex = colorIndex * clarityCount + clarityIndex;
    if (!first || !second || !Number.isFinite(first[valueIndex]) || !Number.isFinite(second[valueIndex])) throw new Error(`Missing price data around ${carat}ct`);
    const current = first[valueIndex]; const next = second[valueIndex]; const nextPrice = Math.exp(next);
    let effectiveNext = next;
    const specialBand = SPECIAL_TARGETS.some((target) => Math.abs(target - to) < 0.0005);
    if (specialBand && Math.abs(carat - to) >= 0.0005) {
      const discount = DISCOUNTS.find((candidate) => nextPrice * (1 - candidate) >= Math.exp(current));
      if (discount) effectiveNext += Math.log(1 - discount);
    }
    const base = Math.exp((1 - ((carat - from) / (to - from))) * current + ((carat - from) / (to - from)) * effectiveNext);
    if (specialBand) return base;
    const threshold = ANCHORS.find((point) => point > carat && point - carat < 0.03);
    const boost = threshold && nextPrice > base ? Math.min(0.1 * Math.exp(-300 * (threshold - carat)), (nextPrice / base - 1) * 0.8) : 0;
    return base * (1 + boost);
  }

  async function getDCXIndex() {
    const data = await getCached('dcx_index', () => fetchFn(`${API_BASE_URL}/index.json`));
    const trends = { '24h': data.trend_24h ?? data.trend, '7d': data.trend_7d, '30d': data.trend_30d };
    const textTrends = Object.entries(trends).filter(([, value]) => Number.isFinite(value)).map(([period, value]) => `${period}: ${formatTrend(value)}`).join('; ') || 'not available';
    return { content: [{ type: 'text', text: `OpenFacet Diamond Composite Index (DCX)\n\nCurrent index: $${data.dcx.toLocaleString()}/carat\nPrice trend: ${textTrends}\n\nMarket basket:\n${(data.specs || []).map((spec) => `- ${spec.carat}ct ${spec.color} ${spec.clarity}: $${spec.per_carat.toLocaleString()}/ct`).join('\n')}\n\nLast updated: ${new Date(data.ts).toLocaleString()}` }], structuredContent: { dcx_usd_per_carat: data.dcx, trends_percent: trends, timestamp: data.ts, specs: data.specs || [] }, _meta: { timestamp: data.ts, source: 'openfacet.net' } };
  }

  async function getMarketDepth({ carat } = {}) {
    if (carat !== undefined && (!Number.isFinite(carat) || carat < 0.3 || carat > 6)) throw new Error('Carat must be a number between 0.3 and 6.0');
    const data = await getCached('market_depth', () => fetchFn(`${API_BASE_URL}/depth.json`));
    if (carat !== undefined) {
      const clarity = data.clarity?.[carat.toFixed(1)] || {}; const color = data.color?.[carat.toFixed(1)] || {};
      const observedOffers = Math.max(sum(clarity), sum(color));
      const availability = observedOffers === 0 ? 'No comparable observed offers are available for these specifications.' : observedOffers < 10 ? 'Limited availability among comparable observed offers.' : observedOffers > 100 ? 'Strong supply among comparable observed offers.' : 'Comparable observed offers are available.';
      return { content: [{ type: 'text', text: `OpenFacet market depth for ${carat.toFixed(2)} ct\n\n${availability}\n\nBy clarity:\n${counts(clarity)}\n\nBy color:\n${counts(color)}` }], structuredContent: { carat, comparable_offer_count: observedOffers, clarity, color, availability }, _meta: { timestamp: data.ts, source: 'openfacet.net' } };
    }
    const availableCarats = Object.keys(data.clarity || {}).map(Number).filter(Number.isFinite).sort((first, second) => first - second);
    const topCombinations = Object.entries(data.colclar || {}).sort((first, second) => second[1] - first[1]).slice(0, 10).map(([specification, observed_offers]) => ({ specification, observed_offers }));
    return { content: [{ type: 'text', text: `OpenFacet diamond market depth\n\nAvailable carat points: ${availableCarats.length ? `${availableCarats[0]}ct to ${availableCarats.at(-1)}ct` : 'no data available'}\n\nTop observed color/clarity combinations:\n${topCombinations.map((item) => `- ${item.specification}: ${item.observed_offers.toLocaleString()} stones`).join('\n')}` }], structuredContent: { available_carats: availableCarats, top_combinations: topCombinations }, _meta: { timestamp: data.ts, source: 'openfacet.net' } };
  }

  const toolAnnotations = { readOnlyHint: true };
  const toolGetDiamondPrice = { name: 'get_diamond_price', title: 'Get Diamond Price', description: 'Quote an OpenFacet diamond price using the live matrix, special-size curve, and shape-ratio adjustment. Results state the supported shape ratio range, the carat-specific observed pricing range, and when an endpoint price is used because a ratio is preference-driven.', annotations: toolAnnotations, inputSchema: { type: 'object', additionalProperties: false, properties: { carat: { type: 'number', minimum: 0.3, maximum: 6 }, color: { type: 'string', enum: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'] }, clarity: { type: 'string', enum: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'] }, shape: { type: 'string', enum: SHAPES, default: 'round' }, shape_ratio: { type: 'number', description: 'Length-to-width ratio for fancy shapes. Defaults to the shape model center. The result returns live supported and observed pricing ranges.' } }, required: ['carat', 'color', 'clarity'] }, outputSchema: { type: 'object', required: ['shape', 'carat', 'color', 'clarity', 'shape_ratio', 'per_carat_usd', 'total_usd', 'tracking_url'], properties: { shape: { type: 'string' }, carat: { type: 'number' }, color: { type: 'string' }, clarity: { type: 'string' }, shape_ratio: { type: 'number' }, supported_ratio_range: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } }, observed_ratio_range: { type: 'object', properties: { min: { type: 'number' }, max: { type: 'number' } } }, price_adjustment_ratio: { type: 'number' }, per_carat_usd: { type: 'number' }, total_usd: { type: 'number' }, ratio_multiplier: { type: 'number' }, preference_driven_ratio: { type: 'boolean' }, tracking_url: { type: 'string' } } } };
  const toolGetDCXIndex = { name: 'get_dcx_index', title: 'Get DCX Index', description: 'Return the OpenFacet Diamond Composite Index with 24-hour, 7-day, and 30-day trends.', annotations: toolAnnotations, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', required: ['dcx_usd_per_carat', 'trends_percent', 'timestamp', 'specs'], properties: { dcx_usd_per_carat: { type: 'number' }, trends_percent: { type: 'object', properties: { '24h': { type: 'number' }, '7d': { type: 'number' }, '30d': { type: 'number' } } }, timestamp: { type: ['number', 'string'] }, specs: { type: 'array', items: { type: 'object', properties: { carat: { type: 'number' }, color: { type: 'string' }, clarity: { type: 'string' }, per_carat: { type: 'number' } } } } } } };
  const toolGetMarketDepth = { name: 'get_market_depth', title: 'Get Market Depth', description: 'Return comparable observed-offer depth, optionally at a carat weight.', annotations: toolAnnotations, inputSchema: { type: 'object', properties: { carat: { type: 'number', minimum: 0.3, maximum: 6 } }, additionalProperties: false }, outputSchema: { oneOf: [{ type: 'object', required: ['carat', 'comparable_offer_count', 'clarity', 'color', 'availability'], properties: { carat: { type: 'number' }, comparable_offer_count: { type: 'number' }, clarity: { type: 'object', additionalProperties: { type: 'number' } }, color: { type: 'object', additionalProperties: { type: 'number' } }, availability: { type: 'string' } } }, { type: 'object', required: ['available_carats', 'top_combinations'], properties: { available_carats: { type: 'array', items: { type: 'number' } }, top_combinations: { type: 'array', items: { type: 'object', required: ['specification', 'observed_offers'], properties: { specification: { type: 'string' }, observed_offers: { type: 'number' } } } } } }] } };
  return handle;
}

function findBand(model, carat) { return model?.bands?.find((band) => carat >= band.minCarat && (band.maxCarat == null || carat <= band.maxCarat)); }
function ratioRanges(model, carat, ratio) { const points = findBand(model, carat)?.points; const supported = model?.slider ? { min: model.slider.min, max: model.slider.max } : null; if (!points?.length) return { supported, observed: null, applied: ratio }; const sorted = [...points].sort((first, second) => first.ratio - second.ratio); return { supported, observed: { min: sorted[0].ratio, max: sorted.at(-1).ratio }, applied: Math.min(sorted.at(-1).ratio, Math.max(sorted[0].ratio, ratio)) }; }
function ratioMultiplier(model, carat, ratio) { const band = findBand(model, carat); if (!band?.points?.length) return 1; const points = [...band.points].sort((first, second) => first.ratio - second.ratio); const clamped = Math.min(points.at(-1).ratio, Math.max(points[0].ratio, ratio)); let value = points.at(-1).value; for (let index = 0; index < points.length - 1; index += 1) { const from = points[index]; const to = points[index + 1]; if (clamped >= from.ratio && clamped <= to.ratio) { value = from.value + ((to.value - from.value) * ((clamped - from.ratio) / (to.ratio - from.ratio))); break; } } return model.valueMode === 'delta_pct' ? 1 + (value / 100) : value / 100; }
function isPreferenceDrivenRatio(model, carat, ratio) { const points = findBand(model, carat)?.points; if (!points?.length) return false; const sorted = [...points].sort((first, second) => first.ratio - second.ratio); return ratio < sorted[0].ratio || ratio > sorted.at(-1).ratio; }
function formatRatioRange(range) { return range ? `${range.min.toFixed(2)}–${range.max.toFixed(2)}` : 'not applicable'; }
function trackingUrlFor(shape, color, clarity, carat, ratio, total, perCarat) { const params = new URLSearchParams({ shape, color, clarity, carat: carat.toFixed(2), ratio: ratio.toFixed(2), ts: `${Math.floor(Date.now() / 1000)}`, price: `${total}`, price_ct: `${perCarat}` }); return `https://openfacet.net/en/my-diamond/?${params}`; }
function formatTrend(value) { return value === 0 ? 'flat' : `${value > 0 ? 'up' : 'down'} ${Math.abs(value).toFixed(2)}%`; }
function sum(values) { return Object.values(values).reduce((total, value) => total + (Number(value) || 0), 0); }
function counts(values) { const entries = Object.entries(values).sort((first, second) => second[1] - first[1]); return entries.length ? entries.map(([key, value]) => `- ${key}: ${Number(value).toLocaleString()} stones`).join('\n') : 'No data available'; }