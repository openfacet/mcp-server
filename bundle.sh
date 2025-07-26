#!/bin/sh

# Strip 'export' from mcp-version.js and core.js
sed 's/^export const/const/' mcp-version.js > _version.tmp.js
sed 's/^export function/function/' core.js | grep -v '^import' > _core.tmp.js

# Remove import lines from worker.js
grep -v '^import' worker.js > _worker.tmp.js

# Concatenate in order: version, core, worker
cat _version.tmp.js _core.tmp.js _worker.tmp.js > worker.bundle.js

# Clean up
rm _version.tmp.js _core.tmp.js _worker.tmp.js

