#!/usr/bin/env bash
set -euo pipefail

# Deploy the consuming Hub, regardless of the caller's current directory.
EDGE_DEPLOY_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$EDGE_DEPLOY_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

all_functions=0
plan_functions=0
for deploy_arg in "$@"; do
  case "$deploy_arg" in
    --all-functions) all_functions=1 ;;
    --plan-functions) plan_functions=1 ;;
    *) echo "Usage: sh edge/deploy.sh [--all-functions] [--plan-functions]" >&2; exit 1 ;;
  esac
done

check_repo() {
  local repo_path="$1"
  local label="$2"

  if ! git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Deploy aborted: ${label} repo not found at '$repo_path'." >&2
    exit 1
  fi

  local current_branch
  current_branch="$(git -C "$repo_path" rev-parse --abbrev-ref HEAD)"
  if [ "$current_branch" != "main" ]; then
    echo "Deploy aborted: ${label} branch is '$current_branch'. Switch to 'main' before deploying." >&2
    exit 1
  fi

  if ! git -C "$repo_path" diff --quiet || ! git -C "$repo_path" diff --cached --quiet; then
    echo "Deploy aborted: ${label} has uncommitted changes. Commit or stash before deploying." >&2
    exit 1
  fi

  if ! git -C "$repo_path" rev-parse --abbrev-ref --symbolic-full-name @{upstream} >/dev/null 2>&1; then
    echo "Deploy aborted: ${label} has no upstream set for 'main'. Set upstream before deploying." >&2
    exit 1
  fi

  git -C "$repo_path" fetch --quiet

  local counts behind ahead
  counts="$(git -C "$repo_path" rev-list --left-right --count @{upstream}...HEAD)"
  set -- $counts
  behind="${1:-0}"
  ahead="${2:-0}"
  if [ "$behind" -ne 0 ] && [ "$ahead" -ne 0 ]; then
    echo "Deploy aborted: ${label} branch has diverged (ahead $ahead, behind $behind). Pull/rebase and push." >&2
    exit 1
  fi
  if [ "$behind" -ne 0 ]; then
    echo "Deploy aborted: ${label} main is behind upstream by $behind commits. Pull before deploying." >&2
    exit 1
  fi
  if [ "$ahead" -ne 0 ]; then
    echo "Deploy aborted: ${label} main is ahead of upstream by $ahead commits. Push before deploying." >&2
    exit 1
  fi
}

warn_edge_subtree_sync() {
  if ! git rev-parse --verify HEAD:edge >/dev/null 2>&1; then
    echo "Deploy aborted: edge subtree path ('edge') is missing from HEAD." >&2
    exit 1
  fi

  if ! git remote get-url edge-vue-components >/dev/null 2>&1; then
    echo "Deploy aborted: remote 'edge-vue-components' is not configured." >&2
    exit 1
  fi

  if ! git fetch --quiet edge-vue-components; then
    echo "Deploy aborted: failed to fetch 'edge-vue-components'." >&2
    exit 1
  fi

  local up_tree local_tree
  if ! up_tree="$(git rev-parse edge-vue-components/main^{tree} 2>/dev/null)"; then
    echo "Deploy aborted: could not resolve edge-vue-components/main." >&2
    exit 1
  fi
  if ! local_tree="$(git rev-parse HEAD:edge 2>/dev/null)"; then
    echo "Deploy aborted: could not resolve HEAD:edge." >&2
    exit 1
  fi

  if [ "$up_tree" = "$local_tree" ]; then
    echo "edge subtree is in sync with edge-vue-components/main"
  else
    echo "Warning: edge subtree differs from edge-vue-components/main. Continuing deploy." >&2
  fi
}

check_pnpm_package_versions() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Deploy aborted: node is required to verify installed pnpm package versions." >&2
    exit 1
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Deploy aborted: pnpm is required to install package versions." >&2
    exit 1
  fi

  run_pnpm_package_version_check() {
  node - <<'NODE'
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const packagePath = path.join(root, 'package.json')
const exactVersionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies']
const mismatches = []

for (const section of dependencySections) {
  const dependencies = packageJson[section] || {}

  for (const [name, expected] of Object.entries(dependencies)) {
    if (!exactVersionPattern.test(String(expected)))
      continue

    const installedPackagePath = path.join(root, 'node_modules', name, 'package.json')
    if (!fs.existsSync(installedPackagePath)) {
      mismatches.push(`${name}: expected ${expected}, installed missing`)
      continue
    }

    let installedVersion = ''
    try {
      installedVersion = JSON.parse(fs.readFileSync(installedPackagePath, 'utf8')).version || ''
    }
    catch {
      mismatches.push(`${name}: expected ${expected}, installed package.json unreadable`)
      continue
    }

    if (installedVersion !== expected)
      mismatches.push(`${name}: expected ${expected}, installed ${installedVersion || 'unknown'}`)
  }
}

if (mismatches.length) {
  console.error('Deploy aborted: installed pnpm package versions do not match package.json exact versions.')
  for (const mismatch of mismatches)
    console.error(` - ${mismatch}`)
  console.error('Run pnpm install before deploying.')
  process.exit(1)
}

console.log('Installed pnpm package versions match package.json exact versions.')
NODE
  }

  if run_pnpm_package_version_check; then
    return
  fi

  echo "Running pnpm install to update local packages..."
  pnpm install

  if ! run_pnpm_package_version_check; then
    echo "Deploy aborted: package versions still do not match after pnpm install." >&2
    exit 1
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Deploy aborted: pnpm install changed tracked files. Commit those changes before deploying." >&2
    exit 1
  fi
}

resolve_functions_region() {
  if [ -n "${FIREBASE_STORE_REGION:-}" ]; then
    echo "$FIREBASE_STORE_REGION"
    return
  fi

  if [ -f "functions/.env.prod" ]; then
    local env_region
    env_region="$(sed -n 's/^FIREBASE_STORE_REGION=//p' functions/.env.prod | tail -n 1 | sed 's/^"//; s/"$//')"
    if [ -n "$env_region" ]; then
      echo "$env_region"
      return
    fi
  fi

  echo "us-west1"
}

resolve_project_id() {
  if [ -n "${PROJECT_ID:-}" ]; then
    echo "$PROJECT_ID"
    return
  fi

  if [ -n "${FIREBASE_PROJECT_ID:-}" ]; then
    echo "$FIREBASE_PROJECT_ID"
    return
  fi

  if [ -f ".firebaserc" ]; then
    local rc_project
    rc_project="$(
      node - <<'NODE'
const fs = require('fs')
const path = '.firebaserc'
try {
  const json = JSON.parse(fs.readFileSync(path, 'utf8'))
  const projectId = json?.projects?.default || ''
  process.stdout.write(projectId)
}
catch {
  process.stdout.write('')
}
NODE
    )"
    if [ -n "$rc_project" ]; then
      echo "$rc_project"
      return
    fi
  fi

  if [ -n "${GCLOUD_PROJECT:-}" ]; then
    echo "$GCLOUD_PROJECT"
    return
  fi

  if [ -n "${GOOGLE_CLOUD_PROJECT:-}" ]; then
    echo "$GOOGLE_CLOUD_PROJECT"
    return
  fi

  if [ -n "${CLOUDSDK_CORE_PROJECT:-}" ]; then
    echo "$CLOUDSDK_CORE_PROJECT"
    return
  fi

  echo ""
}

deploy_selected_functions() {
  set -- --project "$(resolve_project_id)" --region "$(resolve_functions_region)"
  if [ "$all_functions" -eq 1 ]; then set -- "$@" --all-functions; fi
  if [ "$plan_functions" -eq 1 ]; then set -- "$@" --plan-functions; fi
  node edge/scripts/deploy-functions.cjs "$@"
}

# Preview selection without builds, installs, IAM updates or cloud-state writes.
if [ "$plan_functions" -eq 1 ]; then
  deploy_selected_functions
  exit 0
fi

# Fail before Git fetches, dependency installs, builds or preview checks when a
# cooperating deployer holds the shared lock. The later atomic acquisition still
# protects against another deployment starting after this read-only check.
if ! command -v node >/dev/null 2>&1; then
  echo "Deploy aborted: node is required to check for another deployment." >&2
  exit 1
fi
node edge/scripts/deploy-functions.cjs --project "$(resolve_project_id)" --region "$(resolve_functions_region)" --check-lock

check_repo "." "root"
warn_edge_subtree_sync
check_pnpm_package_versions

pnpm run generate
export NODE_ENV=production
# START EDGE CMS PREVIEW CONFIG CHECK
node "$EDGE_DEPLOY_DIR/scripts/configure-cms-preview.cjs" --check "$PROJECT_ROOT"
# END EDGE CMS PREVIEW CONFIG CHECK
deploy_selected_functions
firebase deploy --only hosting --project "$(resolve_project_id)"
firebase deploy --only firestore --project "$(resolve_project_id)"
firebase deploy --only storage --project "$(resolve_project_id)"
