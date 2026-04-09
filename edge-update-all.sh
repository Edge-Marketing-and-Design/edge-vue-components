#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

usage() {
  cat <<'EOF'
Usage: ./edge-update-all.sh

Updates:
1) edge subtree (via edge-pull.sh)
2) sync edge/functions + index and root config files
3) install packages listed in edge/root/edge.packages.json
EOF
}

for arg in "$@"
do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      echo
      usage
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1
then
  echo "pnpm is required (pnpm-lock.yaml is present), but it is not installed."
  echo "Install pnpm and rerun."
  exit 1
fi

sync_edge_functions() {
  edge_functions_dir="$PROJECT_ROOT/edge/functions"
  local_functions_dir="$PROJECT_ROOT/functions"

  if [ ! -d "$edge_functions_dir" ]; then
    return
  fi

  echo "==> Syncing edge/functions into local functions/"

  find "$edge_functions_dir" -type f | sort | while IFS= read -r src_file; do
    rel_path="${src_file#$edge_functions_dir/}"
    if [ "$rel_path" = "index.js" ]; then
      continue
    fi
    dest_file="$local_functions_dir/$rel_path"
    dest_dir="$(dirname "$dest_file")"

    mkdir -p "$dest_dir"

    cp "$src_file" "$dest_file"
  done
}

merge_edge_functions_index() {
  edge_index="$PROJECT_ROOT/edge/functions/index.js"
  local_index="$PROJECT_ROOT/functions/index.js"

  if [ ! -f "$edge_index" ] || [ ! -f "$local_index" ]; then
    return
  fi

  echo "==> Merging extra edge function exports into local functions/index.js"
  EDGE_FUNCTIONS_INDEX_PATH="$edge_index" LOCAL_FUNCTIONS_INDEX_PATH="$local_index" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_FUNCTIONS_INDEX_PATH
const localPath = process.env.LOCAL_FUNCTIONS_INDEX_PATH
const startMarker = '// START EXTRA EDGE functions'
const endMarker = '// END EXTRA EDGE functions'

const readText = filePath => fs.readFileSync(filePath, 'utf8')

const extractMarkedBlock = (text) => {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  if (start === -1 || end === -1 || end < start)
    throw new Error(`Missing ${startMarker}/${endMarker} block in ${edgePath}`)

  const endLine = text.indexOf('\n', end)
  return endLine === -1 ? text.slice(start) : text.slice(start, endLine + 1)
}

const replaceMarkedBlock = (text, replacement) => {
  const start = text.indexOf(startMarker)
  const end = text.indexOf(endMarker)
  const edgeFirebaseEndMarker = '// END @edge/firebase functions'

  if (start === -1 || end === -1 || end < start) {
    const edgeFirebaseEnd = text.indexOf(edgeFirebaseEndMarker)
    if (edgeFirebaseEnd !== -1) {
      const edgeFirebaseEndLine = text.indexOf('\n', edgeFirebaseEnd)
      const insertAt = edgeFirebaseEndLine === -1 ? text.length : edgeFirebaseEndLine + 1
      const before = text.slice(0, insertAt)
      const after = text.slice(insertAt)
      const joiner = before.endsWith('\n\n') ? '' : '\n'
      return `${before}${joiner}${replacement}${after}`
    }
    const normalized = text.endsWith('\n') ? text : `${text}\n`
    return `${normalized}\n${replacement}`
  }

  const endLine = text.indexOf('\n', end)
  const after = endLine === -1 ? '' : text.slice(endLine + 1)
  return `${text.slice(0, start)}${replacement}${after}`
}

const edgeText = readText(edgePath)
const localText = readText(localPath)
const edgeBlock = extractMarkedBlock(edgeText)
const mergedText = replaceMarkedBlock(localText, edgeBlock)

fs.writeFileSync(localPath, mergedText.endsWith('\n') ? mergedText : `${mergedText}\n`)
EOF
}

merge_firestore_indexes() {
  edge_indexes="$PROJECT_ROOT/edge/root/firestore.indexes.json"
  local_indexes="$PROJECT_ROOT/firestore.indexes.json"

  if [ ! -f "$edge_indexes" ]; then
    return
  fi

  if [ ! -f "$local_indexes" ]; then
    echo "==> Writing firestore.indexes.json from edge/root"
    cp "$edge_indexes" "$local_indexes"
    return
  fi

  echo "==> Merging firestore.indexes.json with edge/root priority"
  EDGE_INDEXES_PATH="$edge_indexes" LOCAL_INDEXES_PATH="$local_indexes" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_INDEXES_PATH
const localPath = process.env.LOCAL_INDEXES_PATH

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const edgeJson = readJson(edgePath)
const localJson = readJson(localPath)

const normalizeArray = value => Array.isArray(value) ? value : []
const makeKey = index => JSON.stringify({
  collectionGroup: index?.collectionGroup || '',
  queryScope: index?.queryScope || 'COLLECTION',
  fields: normalizeArray(index?.fields).map(field => ({
    fieldPath: field?.fieldPath || '',
    order: field?.order || '',
    arrayConfig: field?.arrayConfig || '',
    vectorConfig: field?.vectorConfig || null,
  })),
})

const mergedMap = new Map()
for (const index of normalizeArray(localJson.indexes))
  mergedMap.set(makeKey(index), index)
for (const index of normalizeArray(edgeJson.indexes))
  mergedMap.set(makeKey(index), index)

const merged = {
  ...localJson,
  ...edgeJson,
  indexes: Array.from(mergedMap.values()),
}

fs.writeFileSync(localPath, `${JSON.stringify(merged, null, 2)}\n`)
EOF
}

merge_history_config() {
  edge_history_config="$PROJECT_ROOT/edge/root/history.config.json"
  local_history_config="$PROJECT_ROOT/functions/history.config.json"

  if [ ! -f "$edge_history_config" ]; then
    return
  fi

  if [ ! -f "$local_history_config" ]; then
    echo "==> Writing functions/history.config.json from edge/root"
    mkdir -p "$(dirname "$local_history_config")"
    cp "$edge_history_config" "$local_history_config"
    return
  fi

  echo "==> Merging functions/history.config.json with local priority"
  EDGE_HISTORY_CONFIG_PATH="$edge_history_config" LOCAL_HISTORY_CONFIG_PATH="$local_history_config" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_HISTORY_CONFIG_PATH
const localPath = process.env.LOCAL_HISTORY_CONFIG_PATH

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const isPlainObject = value => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const mergeWithLocalPriority = (edgeValue, localValue) => {
  if (localValue === undefined)
    return edgeValue

  if (Array.isArray(edgeValue) || Array.isArray(localValue))
    return localValue

  if (isPlainObject(edgeValue) && isPlainObject(localValue)) {
    const merged = { ...edgeValue }
    for (const key of Object.keys(localValue))
      merged[key] = mergeWithLocalPriority(edgeValue?.[key], localValue[key])
    return merged
  }

  return localValue
}

const edgeJson = readJson(edgePath)
const localJson = readJson(localPath)
const merged = mergeWithLocalPriority(edgeJson, localJson)

fs.writeFileSync(localPath, `${JSON.stringify(merged, null, 2)}\n`)
EOF
}

merge_firebase_json() {
  edge_firebase_json="$PROJECT_ROOT/edge/root/firebase.json"
  local_firebase_json="$PROJECT_ROOT/firebase.json"

  if [ ! -f "$edge_firebase_json" ]; then
    return
  fi

  if [ ! -f "$local_firebase_json" ]; then
    echo "==> Writing firebase.json from edge/root"
    cp "$edge_firebase_json" "$local_firebase_json"
    return
  fi

  echo "==> Merging firebase.json hosting rewrites additions from edge/root"
  EDGE_FIREBASE_JSON_PATH="$edge_firebase_json" LOCAL_FIREBASE_JSON_PATH="$local_firebase_json" node <<'EOF'
const fs = require('fs')

const edgePath = process.env.EDGE_FIREBASE_JSON_PATH
const localPath = process.env.LOCAL_FIREBASE_JSON_PATH

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const edgeJson = readJson(edgePath)
const localJson = readJson(localPath)

const normalizeRewrites = value => Array.isArray(value) ? value : []

const canonicalize = (value) => {
  if (Array.isArray(value))
    return value.map(item => canonicalize(item))
  if (value && typeof value === 'object') {
    const next = {}
    Object.keys(value).sort().forEach((key) => {
      next[key] = canonicalize(value[key])
    })
    return next
  }
  return value
}

const rewriteKey = (rewrite = {}) => {
  const normalized = {
    source: rewrite?.source || '',
    destination: rewrite?.destination || '',
    function: canonicalize(rewrite?.function || ''),
    run: canonicalize(rewrite?.run || ''),
    dynamicLinks: Boolean(rewrite?.dynamicLinks),
  }
  return JSON.stringify(normalized)
}

const localHosting = (localJson.hosting && typeof localJson.hosting === 'object' && !Array.isArray(localJson.hosting))
  ? localJson.hosting
  : {}
const edgeHosting = (edgeJson.hosting && typeof edgeJson.hosting === 'object' && !Array.isArray(edgeJson.hosting))
  ? edgeJson.hosting
  : {}

const localRewrites = normalizeRewrites(localHosting.rewrites)
const edgeRewrites = normalizeRewrites(edgeHosting.rewrites)

const existingKeys = new Set(localRewrites.map(rewrite => rewriteKey(rewrite)))
const rewritesToAdd = edgeRewrites.filter((rewrite) => {
  const key = rewriteKey(rewrite)
  if (existingKeys.has(key))
    return false
  existingKeys.add(key)
  return true
})

if (rewritesToAdd.length > 0) {
  localHosting.rewrites = [...localRewrites, ...rewritesToAdd]
  localJson.hosting = {
    ...localHosting,
  }
}

// Ensure SPA fallback rewrite stays last so it does not shadow later rewrites.
const mergedRewrites = normalizeRewrites(localJson?.hosting?.rewrites)
if (mergedRewrites.length > 1) {
  const spaFallbackRewrites = []
  const orderedRewrites = []
  for (const rewrite of mergedRewrites) {
    if (rewrite?.source === '**' && rewrite?.destination === '/index.html')
      spaFallbackRewrites.push(rewrite)
    else
      orderedRewrites.push(rewrite)
  }
  if (spaFallbackRewrites.length) {
    localJson.hosting = {
      ...(localJson.hosting || {}),
      rewrites: [...orderedRewrites, ...spaFallbackRewrites],
    }
  }
}

fs.writeFileSync(localPath, `${JSON.stringify(localJson, null, 2)}\n`)
EOF
}

install_edge_packages() {
  edge_packages_manifest="$PROJECT_ROOT/edge/root/edge.packages.json"

  if [ ! -f "$edge_packages_manifest" ]; then
    return
  fi

  echo "==> Installing edge-required packages from edge/root/edge.packages.json"

  dep_specs="$(EDGE_PACKAGES_PATH="$edge_packages_manifest" node <<'EOF'
const fs = require('fs')

const manifestPath = process.env.EDGE_PACKAGES_PATH
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const dependencies = (manifest.dependencies && typeof manifest.dependencies === 'object')
  ? manifest.dependencies
  : {}

const specs = Object.entries(dependencies)
  .map(([name, version]) => {
    const normalizedVersion = String(version || '').trim()
    return normalizedVersion ? `${name}@${normalizedVersion}` : name
  })
  .filter(Boolean)

process.stdout.write(specs.join('\n'))
EOF
)"

  if [ -n "$dep_specs" ]; then
    echo "$dep_specs" | while IFS= read -r spec
    do
      if [ -n "$spec" ]; then
        pnpm add "$spec"
      fi
    done
  fi

  dev_dep_specs="$(EDGE_PACKAGES_PATH="$edge_packages_manifest" node <<'EOF'
const fs = require('fs')

const manifestPath = process.env.EDGE_PACKAGES_PATH
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const devDependencies = (manifest.devDependencies && typeof manifest.devDependencies === 'object')
  ? manifest.devDependencies
  : {}

const specs = Object.entries(devDependencies)
  .map(([name, version]) => {
    const normalizedVersion = String(version || '').trim()
    return normalizedVersion ? `${name}@${normalizedVersion}` : name
  })
  .filter(Boolean)

process.stdout.write(specs.join('\n'))
EOF
)"

  if [ -n "$dev_dep_specs" ]; then
    echo "$dev_dep_specs" | while IFS= read -r spec
    do
      if [ -n "$spec" ]; then
        pnpm add -D "$spec"
      fi
    done
  fi
}

echo "==> Updating edge subtree"
"$PROJECT_ROOT/edge-pull.sh"

sync_edge_functions
merge_edge_functions_index
merge_firestore_indexes
merge_history_config
merge_firebase_json
install_edge_packages

echo "==> Done"
