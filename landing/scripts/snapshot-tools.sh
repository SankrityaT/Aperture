#!/usr/bin/env bash
#created by kinjal
# Refresh lib/mcp-tools.json from the live MCP server (initialize + tools/list). The /docs page and /docs.md read it.
# Usage: scripts/snapshot-tools.sh [mcp-url]
set -euo pipefail
URL="${1:-https://calm-steel-d31rh.run.mcp-use.com/mcp}"
cd "$(dirname "$0")/.."
rpc() { curl -s -m 60 -X POST "$URL" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "$1" | sed -n 's/^data: //p'; }
INIT=$(rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"docs-snapshot","version":"0"}}}')
TOOLS=$(rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
INIT="$INIT" TOOLS="$TOOLS" node -e '
const i = JSON.parse(process.env.INIT).result, t = JSON.parse(process.env.TOOLS).result.tools;
const snap = { note: "Snapshot of the live Aperture MCP server (initialize + tools/list). Regenerate with landing/scripts/snapshot-tools.sh.",
  server: i.serverInfo, instructions: i.instructions ?? "",
  tools: t.map((x) => ({ name: x.name, description: x.description ?? "", annotations: x.annotations ?? {}, inputSchema: x.inputSchema ?? {} })) };
require("fs").writeFileSync("lib/mcp-tools.json", JSON.stringify(snap, null, 2) + "\n");
console.log(`lib/mcp-tools.json: ${snap.server.name} ${snap.server.version}, ${snap.tools.length} tools`);'
