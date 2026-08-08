# OpenFacet MCP Server

[![MCP Protocol](https://img.shields.io/badge/MCP-2026--07--28-blue)](https://modelcontextprotocol.io/specification/2026-07-28)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

A Model Context Protocol (MCP) implementation for the [OpenFacet](https://openfacet.net) Diamond Pricing API. Provides transparent, real-time diamond pricing data with interpolation algorithms and market depth analytics.

Built with vanilla JavaScript and core modules only - zero external dependencies.

## Features

* Implements MCP 2026-07-28 (stateless per-request metadata, structured content, and HTTP metadata validation)
* Tools: `get_diamond_price`, `get_dcx_index`, `get_market_depth`
* Real-time interpolation over carat/color/clarity
* DCX Index and inventory snapshot with daily refresh
* Single-file deployable; no dependencies
* Runtime adapters:
  * **Node.js**: HTTP server, CORS, configurable port
  * **Cloudflare Worker**: single fetch entrypoint

## Project Structure

```
mcp-server/
├── core.js         # Shared logic, tool handlers, interpolation
├── stdio.js        # Local stdio transport
├── node.js         # Node.js HTTP server (PORT via CLI or env)
├── worker.js       # Remote Cloudflare Worker
├── test-core.js    # Vanilla JS test runner
├── mcp-version.js  # Protocol version constant
└── README.md
```

## Usage

Requires Node.js ≥18, clone the repository:

```bash
git clone https://github.com/openfacet/mcp-server.git
cd mcp-server
```

### Local stdio Transport

The stdio transport is the default for most MCP clients.

```bash
# Start the server
node stdio.js
```

Send a message (paste this JSON and press Enter):

```plain
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_diamond_price","arguments":{"carat":1.23,"color":"G","clarity":"VS2","shape":"emerald","shape_ratio":1.58},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}
```

You'll get a response like:

```plain
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"OpenFacet diamond price quote..."}],"structuredContent":{"shape":"emerald","per_carat_usd":4487,"total_usd":5519,"tracking_url":"https://openfacet.net/en/my-diamond/?..."}}}
```

### Local Node.js HTTP server

Default binds to `localhost:3000/`. Available endpoints:

* `POST /`: JSON-RPC entrypoint
* `GET /health`: Server status
* `GET /.well-known/mcp.json`: Discovery metadata

### Remote MCP Server

Remote server for testing `https://mcp.openfacet.net`. Example price query:

```bash
curl -X POST https://mcp.openfacet.net/ \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2026-07-28" \
  -H "Mcp-Method: tools/call" \
  -H "Mcp-Name: get_diamond_price" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_diamond_price",
      "arguments": {
        "carat": 1.23,
        "color": "G",
        "clarity": "VS2",
        "shape": "emerald",
        "shape_ratio": 1.58
      },
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

## Tool Summary

### `get_diamond_price`

Returns an OpenFacet price quote using website interpolation, special-size discounts, and shape-ratio models.

Parameters:
* `carat`: number (0.3–6.0)
* `color`: string (D–M)
* `clarity`: string (FL–I3)
* `shape`: string (optional, default: "round"): `round`, `cushion`, `radiant`, `emerald`, `oval`, `pear`, `marquise`, or `heart`
* `shape_ratio`: number (optional). Uses the shape model's center ratio when omitted.

Results include a shareable OpenFacet tracking URL. Ratios outside the observed model range are identified as preference-driven.

### `get_dcx_index`

Returns composite index of diamond price trends, comparing 24-hour, 7-day, and 30-day changes. No parameters.

### `get_market_depth`

Returns observed-offer inventory data. Optional parameter:
* `carat`: number

## Testing

```bash
node core-test.js
bash bundle.sh
```

Covers:
* Per-request MCP metadata and structured tool results
* Website special-size interpolation and fancy-shape ratio adjustments
* DCX trend and market-depth parsing
* Cloudflare Worker bundle syntax

## Technical Notes

### Interpolation

* Log-space interpolation across fixed breakpoints
* Log-space interpolation with website anchor smoothing
* Website special-size discounts below 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, and 5.0ct anchors
* Ratio-band multipliers for supported fancy shapes

### Specifications

* API docs: [https://openfacet.net/en/api-docs/](https://openfacet.net/en/api-docs/)
    * `/matrix.json` and `/matrix_cushion.json`: base pricing matrices
    * `/index.json`: DCX index and trend
    * `/depth.json`: market depth by carat/color/clarity
* Pricing methodology: [https://openfacet.net/en/methodology/](https://openfacet.net/en/methodology/)
