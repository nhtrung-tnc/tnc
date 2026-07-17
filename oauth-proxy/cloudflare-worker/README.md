# Decap OAuth Proxy on Cloudflare Workers

This Worker is a lightweight OAuth proxy for `Decap CMS + GitHub backend`.

It follows the Decap model documented in the backend overview:

- `/auth` starts the GitHub authorization flow
- `/callback` exchanges the returned code for an access token and posts it back to the Decap popup

Relevant references:

- Decap backend overview: https://decapcms.org/docs/backends-overview/
- GitHub OAuth app creation: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- GitHub OAuth token exchange: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/

## 1. Create a GitHub OAuth app

Create an OAuth app in GitHub with:

- Homepage URL: your main website or admin URL
- Authorization callback URL: your Worker callback URL, for example:
  - `https://oauth.tnchandicraft.com/callback`

GitHub notes that OAuth apps are still supported, though GitHub Apps are generally preferred for new app designs. Decap’s GitHub backend flow still expects an OAuth-style proxy.

## 2. Configure the Worker

Copy the example config:

- `wrangler.toml.example` -> `wrangler.toml`

This repository already includes a ready-to-edit `wrangler.toml` configured for:

- zone: `tnchandicraft.com`
- custom domain: `oauth.tnchandicraft.com`

Set allowed origins:

- `ALLOWED_ORIGINS="https://tnchandicraft.com,https://www.tnchandicraft.com"`

Then add secrets:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

## 3. Deploy

```bash
wrangler deploy
```

## 4. Connect Decap CMS

Update `static/admin/config.yml`:

```yaml
backend:
  name: github
  repo: nhtrung-tnc/tnc
  branch: main
  base_url: https://oauth.tnchandicraft.com
  auth_endpoint: auth
```

The GitHub OAuth callback URL must exactly match the Worker’s `/callback` URL.

## 5. Production notes

- Restrict `ALLOWED_ORIGINS` to your real site origins only.
- If your repo belongs to a GitHub organization with OAuth app restrictions enabled, the organization may need to approve the app.
- If your CMS login popup hangs after authorization, verify the exact callback URL and the exact site origin.
- If you use the custom hostname `oauth.tnchandicraft.com`, point that subdomain to your deployed Worker in Cloudflare before testing login.
