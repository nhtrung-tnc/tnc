# TNC production cutover and rollback

Status: **completed on 2026-10-10**.

## Completed gates

- [x] Protected Astro test deployment accepted with real Admin and Editor OTP sessions.
- [x] Public, preview, media, role, cache purge and two-edge freshness checks passed.
- [x] Production D1/R2 backup and restore rehearsal completed.
- [x] Hugo content schema-validated and imported as published VI/EN/JA CMS snapshots.
- [x] Access covers `/admin`, `/api/admin` and `/preview` on production and test hostnames.
- [x] `CACHE_PURGE_TOKEN` installed as a Worker secret.
- [x] Apex and `www` moved to Astro with Cloudflare Worker Routes.
- [x] Production smoke passed on both hostnames.
- [x] Acceptance fixtures, temporary D1/R2 resources and privileged session state removed.

## Current routing

- `tnchandicraft.com/*` → Astro Worker.
- `www.tnchandicraft.com/*` → Astro Worker, with canonical metadata pointing to apex.
- `oauth.tnchandicraft.com/*` → legacy OAuth Worker.
- `workers.dev` and preview aliases are disabled.

Existing proxied DNS records, GitHub Pages, Hugo and Decap are retained as rollback assets. Production traffic is served by the Astro Worker.

## Routing rollback

1. Remove only the two Worker Routes for apex and `www`, using the protected pre-cutover route snapshot.
2. Confirm the retained GitHub Pages site answers on apex and `www`.
3. Keep D1, R2, backups, Access identities and the legacy OAuth route unchanged.
4. If Worker code rollback is required, select the recorded compatible deployment and keep the current D1 schema.
5. Restore data into fresh D1/R2 resources before changing bindings; never delete production storage as part of routing rollback.

See [deployment evidence](deployment-evidence.md) for sanitized acceptance results.
