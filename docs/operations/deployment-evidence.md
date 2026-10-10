# Cloudflare production deployment evidence

Status: **Astro production cutover completed on 2026-10-10**.

This file contains sanitized evidence only. API tokens, identities, JWTs, account/zone/database identifiers and signed URLs are intentionally omitted.

## Production routing

- `tnchandicraft.com/*` and `www.tnchandicraft.com/*` route to the `tnc-handicraft` Astro Worker.
- The cutover uses Cloudflare Worker Routes, so the existing proxied DNS records and GitHub Pages deployment remain available as rollback infrastructure.
- `oauth.tnchandicraft.com/*` remains routed to the legacy OAuth Worker and its modification timestamp was unchanged during the migration.
- The public `workers.dev` hostname and preview aliases are disabled.
- `SITE_ORIGIN` is `https://tnchandicraft.com`; apex is the canonical origin. `www` serves the same Worker and emits apex canonical metadata.

## Content migration

- Tracked Hugo content was schema-validated before import into D1.
- Imported four CMS items: one homepage, two insights and one settings item.
- Imported and published 12 localized snapshots across VI, EN and JA.
- Production now has 12 immutable revisions and 12 published routes. The sitemap exposes nine public homepage/insight URLs and excludes settings/private routes.
- Source-file checksums and sanitized import counts are retained in protected operator evidence.

## Access and authenticated acceptance

- One Cloudflare Access application protects `/admin`, `/api/admin` and `/preview` on apex, `www` and the protected test hostname.
- The allow policy contains exactly the configured Admin and Editor identities, has no bypass/everyone selector, and uses one-hour sessions.
- Admin acceptance passed for dashboard, user/content/media APIs, draft isolation, preview, media upload and checksum deduplication, private/public media serving, image WebP/AVIF transformations, immutable publication snapshots, restore-to-draft and publishing.
- Editor acceptance passed for dashboard, content editing, preview and private media upload. User management, publish, revision restore and media deletion returned 403; stale writes returned 409 and cross-origin mutation returned 403.
- OTP cookies, login forms, callback state and local privileged session files were deleted after evidence was recorded.

## Cache and edge acceptance

- `CACHE_PURGE_TOKEN` is stored as a Worker secret and is absent from tracked configuration.
- Application publication returned `cacheStatus: purged`.
- The same warmed FRA and GRU edges served the old revision before publication and the new revision on the first observation after tag purge.
- Purging used path-specific Cache Tags. Purge Everything was not used.
- The disposable acceptance route returned 404 from both edge locations after cleanup.

## Public and recovery verification

- Production smoke passed 8/8 on both apex and `www`: root locale redirect, VI/EN/JA homepages, sitemap, and three private-root denial checks.
- Additional checks passed for localized insight lists/articles, robots, security headers and canonical production URLs.
- Unit tests passed 18/18 and integration tests passed 87/87; the production build completed with zero errors.
- A pre-cutover backup was stored before content import and route changes.
- A post-cutover D1/R2-inventory backup was restored into fresh temporary D1/R2 resources. All database rows and the media inventory matched; the temporary resources were then removed.
- Acceptance fixtures and media were removed. Production retains four content items, 12 locales, 12 immutable revisions, 12 routes, two configured users, zero media objects and both revision-protection triggers.

## Rollback position

- The pre-cutover Worker-route set and compatible Worker deployment are recorded in protected operator evidence.
- Rollback removes only the two Astro Worker Routes for apex and `www`; DNS and GitHub Pages were not overwritten.
- D1/R2 must not be deleted during routing rollback. Restore into fresh resources first if storage recovery is required.

## Remaining operational follow-up

- Direct DNS-record inventory remains unavailable to the deployment token (Cloudflare authentication error on the DNS Records API). Worker Routes avoided any DNS mutation.
- Cloudflare plan limits, D1 Time Travel retention and Workers Builds branch controls should still be reviewed periodically in the dashboard.
