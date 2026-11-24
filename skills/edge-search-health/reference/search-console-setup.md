# Search Console access

The search health scripts read Search Console with read-only access
(`webmasters.readonly`). They take one credentials file, from
`--credentials`, `EDGE_SEARCH_CONSOLE_CREDENTIALS`, or
`~/.config/edge-search-console/credentials.json`. Keep it out of every
repository; never paste its contents into a chat, issue or document.

Two kinds of file work. Pick one.

## A. A service account (recommended for scheduled audits)

A robot account with its own key. It sees only the properties it is added
to, never expires, and doesn't depend on a person's login.

1. Create it once, in the Google Cloud project the Hub uses
   (`clearwater-hub` for Clearwater; any project works):

   ```bash
   gcloud services enable searchconsole.googleapis.com --project=clearwater-hub
   ```

   ```bash
   gcloud iam service-accounts create edge-search-console --display-name="Edge search health (read-only)" --project=clearwater-hub
   ```

   ```bash
   mkdir -p ~/.config/edge-search-console && chmod 700 ~/.config/edge-search-console
   ```

   ```bash
   gcloud iam service-accounts keys create ~/.config/edge-search-console/credentials.json --iam-account=edge-search-console@clearwater-hub.iam.gserviceaccount.com --project=clearwater-hub
   ```

   ```bash
   chmod 600 ~/.config/edge-search-console/credentials.json
   ```

   If the last-but-one command fails with
   `constraints/iam.disableServiceAccountKeyCreation`, the organization
   blocks keys: use B.

2. Add it to each site's property: Search Console > the property >
   Settings > Users and permissions > Add user >
   `edge-search-console@clearwater-hub.iam.gserviceaccount.com`, permission
   **Restricted**. Only an owner of the property can add users. Repeat for
   every site the audit should cover.

## B. Your own Google login

Uses the Search Console access you already have, on every property you can
see. Needs an OAuth "Desktop app" client in a Cloud project with the Search
Console API enabled (Clearwater: `~/.config/gcloud/clearwater-oauth-client.json`
in `clearwater-hub`, the same client the analytics connector uses).

```bash
gcloud services enable searchconsole.googleapis.com --project=clearwater-hub
```

```bash
mkdir -p ~/.config/edge-search-console && chmod 700 ~/.config/edge-search-console
```

Sign in through a temporary gcloud folder, so your normal gcloud
application-default login is left alone, and keep the resulting file:

```bash
export CLOUDSDK_CONFIG="$(mktemp -d)" && gcloud auth application-default login --client-id-file="$HOME/.config/gcloud/clearwater-oauth-client.json" --scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/webmasters.readonly && cp "$CLOUDSDK_CONFIG/application_default_credentials.json" ~/.config/edge-search-console/credentials.json && chmod 600 ~/.config/edge-search-console/credentials.json && rm -rf "$CLOUDSDK_CONFIG"; unset CLOUDSDK_CONFIG
```

If the client's OAuth consent screen is in **Testing** with an External
user type, Google expires the login after 7 days, which breaks scheduled
audits: set it to Internal (Workspace) or publish it, or use A.

## Check it

```bash
node edge/skills/edge-search-health/scripts/search-console.mjs sites
```

It lists the properties the account can read. An empty list means the
account hasn't been added to any property (A, step 2).
