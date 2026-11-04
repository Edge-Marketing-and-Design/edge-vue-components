#!/bin/sh
# Starts the local Edge CMS MCP server (src/server.js) for the Hub checkout
# this file is in. Every Hub's .mcp.json calls it:
#
#   "command": "sh",
#   "args": ["-c", "exec sh \"$(git rev-parse --show-toplevel)/edge/tools/mcp/cms/launch.sh\""],
#   "env": { "EDGE_CMS_MCP_CONFIG": "...", "EDGE_CMS_MCP_CREDENTIALS": "..." }
#
# Before starting the server it keeps the tools current:
# - fetches origin/main for the Hub checkout and for the emd-cms-front checkout
#   the server reads (EDGE_CMS_RENDERER_REPO), with a short timeout; offline,
#   the fetch is skipped;
# - fast-forwards a checkout that is on main, clean and behind; anything else
#   (another branch, a worktree, local changes, local commits) is left alone
#   and reported as behind;
# - runs `npm ci` when the server's node_modules no longer match its
#   package-lock.json;
# - passes the result to the server as EDGE_CMS_CHECKOUT_STATUS (JSON), which
#   the server reports in cms_guide, cms_contract and cms_agent_organizations.
#
# stdout belongs to the MCP protocol: everything here writes to stderr.
#
# Settings (environment):
#   EDGE_CMS_FRESHNESS=off            skip fetch, fast-forward and npm ci
#   EDGE_CMS_FETCH_TIMEOUT=8          seconds per fetch
#   EDGE_CMS_RENDERER_REPO            emd-cms-front checkout (default: next to the main Hub checkout)
#   EDGE_CMS_WORKSPACE_ROOT           block workspace (default: <main checkout>/.tmp/cms-block-workspace)
#   EDGE_CMS_LAUNCH_PRINT_STATUS=1    print the status JSON to stdout and exit (tests)

d=edge/tools/mcp/cms
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
root=$(git -C "$here" rev-parse --show-toplevel) || { echo "edge-cms launch: $here is not in a git checkout" >&2; exit 1; }
main=$(cd "$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)/.." && pwd) || exit 1
cd "$root" || exit 1

log() { echo "edge-cms launch: $*" >&2; }

# Runs a command with a time limit (macOS has no `timeout`). Returns 124 when
# the limit is hit.
with_timeout() {
  limit=$1
  shift
  "$@" >/dev/null 2>&1 &
  cmd_pid=$!
  ( sleep "$limit" && kill "$cmd_pid" 2>/dev/null ) >/dev/null 2>&1 &
  timer_pid=$!
  wait "$cmd_pid"
  cmd_status=$?
  if kill "$timer_pid" 2>/dev/null; then
    wait "$timer_pid" 2>/dev/null
    return "$cmd_status"
  fi
  return 124
}

json_string() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"; }

# check_checkout <dir>: fetch, fast-forward when safe, and print one JSON
# object: { state, branch, behind, ahead, dirty, fetched, detail }.
# state: current | updated | behind | unchecked | not-a-checkout
check_checkout() {
  dir=$1
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '{"state":"not-a-checkout","path":%s}' "$(json_string "$dir")"
    return
  fi
  branch=$(git -C "$dir" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "detached")
  fetched=false
  detail=""
  if [ "${EDGE_CMS_FRESHNESS:-on}" != "off" ]; then
    if GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=5}" \
      with_timeout "${EDGE_CMS_FETCH_TIMEOUT:-8}" git -C "$dir" fetch --quiet origin main; then
      fetched=true
    else
      detail="could not fetch origin/main (offline or no access)"
    fi
  else
    detail="freshness checks are off (EDGE_CMS_FRESHNESS=off)"
  fi
  if ! git -C "$dir" rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    printf '{"state":"unchecked","branch":%s,"fetched":%s,"detail":%s}' "$(json_string "$branch")" "$fetched" "$(json_string "${detail:-no origin/main}")"
    return
  fi
  behind=$(git -C "$dir" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  ahead=$(git -C "$dir" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  dirty=false
  [ -n "$(git -C "$dir" status --porcelain --untracked-files=no 2>/dev/null)" ] && dirty=true
  state=current
  if [ "$behind" -gt 0 ]; then
    state=behind
    if [ "$fetched" = true ] && [ "$branch" = main ] && [ "$dirty" = false ] && [ "$ahead" -eq 0 ]; then
      if git -C "$dir" merge --ff-only --quiet origin/main >/dev/null 2>&1; then
        log "fast-forwarded $dir to origin/main ($behind commits)"
        detail="fast-forwarded $behind commits"
        state=updated
        behind=0
      else
        detail="fast-forward failed"
      fi
    elif [ "$branch" != main ]; then
      detail="on $branch, not main: left as it is"
    elif [ "$dirty" = true ]; then
      detail="main has local changes: left as it is"
    elif [ "$ahead" -gt 0 ]; then
      detail="main has $ahead local commits: left as it is"
    fi
  fi
  [ "$fetched" = false ] && [ "$state" = current ] && state=unchecked
  printf '{"state":"%s","branch":%s,"behind":%s,"ahead":%s,"dirty":%s,"fetched":%s,"detail":%s}' \
    "$state" "$(json_string "$branch")" "$behind" "$ahead" "$dirty" "$fetched" "$(json_string "$detail")"
}

export EDGE_CMS_RENDERER_REPO="${EDGE_CMS_RENDERER_REPO:-$main/../emd-cms-front}"
export EDGE_CMS_WORKSPACE_ROOT="${EDGE_CMS_WORKSPACE_ROOT:-$main/.tmp/cms-block-workspace}"

hub_status=$(check_checkout "$root")
if [ -d "$EDGE_CMS_RENDERER_REPO" ]; then
  renderer_status=$(check_checkout "$EDGE_CMS_RENDERER_REPO")
else
  renderer_status=$(printf '{"state":"missing","path":%s}' "$(json_string "$EDGE_CMS_RENDERER_REPO")")
fi

# A worktree uses the main checkout's dependencies.
[ -e "$d/node_modules" ] || [ "$root" = "$main" ] || ln -s "$main/$d/node_modules" "$d/node_modules"

# Node from the Hub's .nvmrc when nvm has it.
nv=$(tr -d '[:space:]v' < "$root/.nvmrc" 2>/dev/null)
n="$HOME/.nvm/versions/node/v$nv/bin/node"
[ -n "$nv" ] && [ -x "$n" ] || n=node

# Dependencies: npm ci where node_modules really lives when they no longer
# match its package-lock.json (node_modules/.package-lock.json is npm's record
# of what is installed).
deps=current
modules_dir=$(cd "$d/node_modules" 2>/dev/null && pwd -P)
[ -n "$modules_dir" ] || modules_dir="$main/$d/node_modules"
pkg_dir=$(dirname "$modules_dir")
if [ "${EDGE_CMS_FRESHNESS:-on}" != "off" ] && [ -f "$pkg_dir/package-lock.json" ]; then
  if ! "$n" -e '
    const fs = require("node:fs")
    const [lockFile, installedFile] = process.argv.slice(1)
    const wanted = JSON.parse(fs.readFileSync(lockFile, "utf8")).packages || {}
    let installed = {}
    try { installed = JSON.parse(fs.readFileSync(installedFile, "utf8")).packages || {} } catch { process.exit(1) }
    for (const [name, entry] of Object.entries(wanted)) {
      if (!name || entry.dev || entry.optional) continue
      if (installed[name]?.version !== entry.version) process.exit(1)
    }
  ' "$pkg_dir/package-lock.json" "$modules_dir/.package-lock.json" >/dev/null 2>&1; then
    npm_bin="$(dirname "$n")/npm"
    [ -x "$npm_bin" ] || npm_bin=npm
    log "installing the CMS MCP dependencies in $pkg_dir (npm ci)"
    if (cd "$pkg_dir" && PATH="$(dirname "$n"):$PATH" "$npm_bin" ci --no-audit --no-fund >&2); then
      deps=installed
    else
      deps=install-failed
      log "npm ci failed in $pkg_dir; starting with the existing dependencies"
    fi
  fi
fi

export EDGE_CMS_CHECKOUT_STATUS="{\"hub\":$hub_status,\"renderer\":$renderer_status,\"dependencies\":\"$deps\",\"checkedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

if [ "${EDGE_CMS_LAUNCH_PRINT_STATUS:-}" = 1 ]; then
  printf '%s\n' "$EDGE_CMS_CHECKOUT_STATUS"
  exit 0
fi

exec "$n" "$d/src/server.js"
