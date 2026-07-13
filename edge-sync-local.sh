#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
EDGE_FUNCTIONS="$SCRIPT_DIR/functions"
LOCAL_FUNCTIONS="$PROJECT_ROOT/functions"

if [ ! -d "$EDGE_FUNCTIONS" ] || [ ! -d "$LOCAL_FUNCTIONS" ]; then
  echo "Run this command from a Hub containing edge/functions and functions." >&2
  exit 1
fi

echo "==> Synchronizing shared Functions locally (no pull, install, commit, or push)"
find "$EDGE_FUNCTIONS" -type f | sort | while IFS= read -r source_file; do
  relative_path="${source_file#$EDGE_FUNCTIONS/}"
  if [ "$relative_path" = "index.js" ] || [ "$relative_path" = "edge.packages.json" ]; then
    continue
  fi
  destination_file="$LOCAL_FUNCTIONS/$relative_path"
  mkdir -p "$(dirname "$destination_file")"
  if [ ! -f "$destination_file" ] || ! cmp -s "$source_file" "$destination_file"; then
    cp "$source_file" "$destination_file"
    echo "synced functions/$relative_path"
  fi
done

EDGE_FUNCTIONS_INDEX_PATH="$EDGE_FUNCTIONS/index.js" LOCAL_FUNCTIONS_INDEX_PATH="$LOCAL_FUNCTIONS/index.js" node <<'NODE'
const fs = require('fs')

const edgePath = process.env.EDGE_FUNCTIONS_INDEX_PATH
const localPath = process.env.LOCAL_FUNCTIONS_INDEX_PATH
const startMarker = '// START EXTRA EDGE functions'
const endMarker = '// END EXTRA EDGE functions'
const edgeText = fs.readFileSync(edgePath, 'utf8')
const localText = fs.readFileSync(localPath, 'utf8')
const edgeStart = edgeText.indexOf(startMarker)
const edgeEnd = edgeText.indexOf(endMarker)
if (edgeStart === -1 || edgeEnd < edgeStart)
  throw new Error('Shared Function export markers are missing.')
const edgeEndLine = edgeText.indexOf('\n', edgeEnd)
const block = edgeEndLine === -1 ? edgeText.slice(edgeStart) : edgeText.slice(edgeStart, edgeEndLine + 1)
const localStart = localText.indexOf(startMarker)
const localEnd = localText.indexOf(endMarker)
if (localStart === -1 || localEnd < localStart)
  throw new Error('Hub Function export markers are missing.')
const localEndLine = localText.indexOf('\n', localEnd)
const after = localEndLine === -1 ? '' : localText.slice(localEndLine + 1)
const merged = `${localText.slice(0, localStart)}${block}${after}`
if (merged !== localText) {
  fs.writeFileSync(localPath, merged.endsWith('\n') ? merged : `${merged}\n`)
  console.log('merged functions/index.js shared export block')
}
NODE

echo "==> Local shared Function synchronization complete"
