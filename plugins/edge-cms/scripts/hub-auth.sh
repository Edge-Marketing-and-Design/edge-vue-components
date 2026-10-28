#!/bin/sh
# headersHelper for the edge-cms MCP server: prints the Authorization header
# from the person's Hub connection credential file, so the credential never
# sits in the plugin or Claude's settings. EDGE_CMS_CONNECTION_FILE overrides
# the path.
file="${EDGE_CMS_CONNECTION_FILE:-$HOME/.config/emd-cms/cms-agent-connection}"
if [ ! -r "$file" ]; then
  echo "edge-cms: no Hub connection credential at $file (Hub: Dev Mode, Agent Keys, Hub connections, Create)" >&2
  exit 1
fi
token=$(tr -d '[:space:]' < "$file")
case "$token" in
  cmsac.*) ;;
  *) echo "edge-cms: $file does not hold a cmsac.… credential" >&2; exit 1 ;;
esac
printf '{"Authorization":"Bearer %s"}\n' "$token"
