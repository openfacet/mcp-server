# OpenFacet MCP Server

[![MCP Protocol](https://img.shields.io/badge/MCP-2025--06--18-blue)](https://spec.modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

A Model Context Protocol (MCP) implementation for the [OpenFacet](https://openfacet.net) Diamond Pricing API. Provides transparent, real-time diamond pricing data with interpolation algorithms and market depth analytics.

Built with vanilla JavaScript and core modules only - zero external dependencies.

## Features

* Implements MCP 2025‑06‑18 (no batch support, structured content, version headers)
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
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_diamond_price","arguments":{"carat":1.23,"color":"G","clarity":"VS2"}}}
```

You'll get a response like:

```plain
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"💎 **Diamond Price Quote**\n\n**Specifications:**\n• Carat: 1.23ct\n• Color: G\n• Clarity: VS2\n• Shape: round\n\n**Pricing:**\n• Per Carat: $4,487\n• Total Price: $5,519.01\n\n*Prices from OpenFacet.net API*"}],"_meta":{"timestamp":"2025-07-11T10:21:50.460Z","source":"OpenFacet.net API"}}}
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
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_diamond_price",
      "arguments": {
        "carat": 1.23,
        "color": "G",
        "clarity": "VS2"
      }
    }
  }'
```

## Tool Summary

### `get_diamond_price`

Returns interpolated pricing for round/cushion GIA diamonds.

Parameters:
* `carat`: number (0.3–6.0)
* `color`: string (D–M)
* `clarity`: string (FL–I3)
* `shape`: string (optional, default: "round")

### `get_dcx_index`

Returns composite index of diamond price trends. No parameters.

### `get_market_depth`

Returns inventory data. Optional parameter:
* `carat`: number

## Testing

```bash
node test-core.js
```

Covers:
* Interpolation behavior
* DCX/market depth parsing
* Error conditions
* JSON-RPC correctness

## Technical Notes

### Interpolation

* Log-space interpolation across fixed breakpoints
* Anchor smoothing near psychological thresholds (0.3, 0.5, 1.0, etc.)
* Dynamic boost if price trend continues beyond a band

### Specifications

* API docs: [https://openfacet.net/en/api-docs/](https://openfacet.net/en/api-docs/)
    * `/matrix.json` and `/matrix_cushion.json`: base pricing matrices
    * `/index.json`: DCX index and trend
    * `/depth.json`: market depth by carat/color/clarity
* Pricing methodology: [https://openfacet.net/en/methodology/](https://openfacet.net/en/methodology/)
