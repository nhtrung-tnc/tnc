# Cloudflare deployment evidence

Status: **Task 15 test Worker deployed; production acceptance blocked by protected identity/login and purge configuration**.

Rechecked after account onboarding at 2026-10-09 13:37 UTC (20:37 Asia/Saigon), continuing from `34e16f3` on `codex/astro-cloudflare-migration`. Handoff commit remains `b76cdd0f450eb6282d3fb5fe6873439a44e42d96`; existing work was preserved. This evidence supersedes the earlier unauthenticated and account-onboarding blockers.

## Verified state

- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are present; their values were not printed. `environment_status` reports current observations but readiness `unknown`, so readiness is established only for the API calls that actually succeeded.
- Wrangler 4.149.0 `whoami` authenticated successfully. Raw identity output was kept out of published evidence.
- Existing production D1 `tnc-cms-production` was located and reused; no duplicate database was created. Migration `0001_cms.sql` was already applied and was not reapplied. Remote schema verification found nine CMS tables, one applied migration, zero users and zero content items.
- Resource identifiers are selected programmatically into ignored `.operations.d1.jsonc`; no production identifier is committed. This is a D1 operations config, not a deployable production Worker config.
- `npm ci`, `npm run check` and `npm run verify` exited successfully: 16 unit tests and 87 integration tests passed; browser E2E had six passed and **seven skipped**. The skipped Admin/Editor/publishing tests require Access JWTs and an item fixture. Exit zero with skips is **not production acceptance**.
- Operations integration tests exercise initial Admin bootstrap, backup pagination over 1,005 synthetic media objects, checksums, retention of four completed sets, failure preservation and restore verification using test adapters. These are not a real production backup or restore rehearsal.
- Local Astro build and Wrangler deploy dry-run passed. The existing build was subsequently deployed using ignored production bindings. The first upload failed validation because additional Astro modules were omitted; adding ESModule rules and `find_additional_modules` resolved it. The successful version is recorded privately in ignored `.operations.deployment.json`.

## Test deployment and recovery evidence

- Test origin: **https://tnc-handicraft.khc-32f.workers.dev**. Production D1, MEDIA, IMAGES and ASSETS bindings and daily Cron were deployed. Preview URLs are disabled in the production config.
- Created R2 `tnc-media-production` and separate `tnc-backup-production` after successful R2 preflight. Existing production D1 was reused.
- Access organization preflight succeeded and confirmed `tnchandicraft.cloudflareaccess.com`. Created one application covering the three private destinations with a deny-everyone policy pending explicit identity configuration. No allow policy or Admin/Editor record was inferred from the API token owner.
- Real production smoke: **8/8 passed** (root redirect, three homepages, sitemap, three private routes). A separate six-path check confirmed both private roots and descendants return redirects to the expected Access team domain. Public missing media returned 404. These unauthenticated checks do not establish authenticated acceptance.
- The Node smoke command requires `NODE_USE_ENV_PROXY=1` in this managed environment. An initial direct Node fetch failed; proxy-aware smoke passed. Python's default User-Agent also received edge error 1010 on the test origin; a normal browser User-Agent produced the expected public and private responses. Those initial errors are not counted as Access denial evidence.
- D1 was exported using official Wrangler and stored at `preacceptance/2026-10-09T13-37-44Z/database.sql` in the backup bucket. Reading it back verified identical SHA-256. The export contains 4,840 bytes.
- A separate D1 `tnc-cms-rehearsal-20261009` was created and the export imported with official Wrangler. Remote source/restored verification matched all nine CMS tables and zero users, content items and revisions. This proves an initial D1-only restore, **not** restoration of published content or a full R2-inventory backup manifest. The rehearsal resource is retained for evidence.

## Remaining blockers

| API check | Observed result | Required next action |
| --- | --- | --- |
| D1 database list/query | Successful | Reuse the existing database; confirm actual plan and Time Travel retention before deployment. |
| R2 bucket list | Successful after subscription activation | Resolved; two production buckets created. |
| Access organization and applications | Successful after Zero Trust Free onboarding | Resolved; team domain confirmed and protected test application created. |
| Access identity providers | Read succeeds with zero providers; attempted OTP creation returns HTTP 403, code `1010` | Configure a login method in the Zero Trust dashboard, or grant the corresponding Identity Providers Edit permission and retry. The response alone does not prove a unique authorization cause. |
| Initial Admin/Editor identities | Protected runtime identities absent | Supply `ADMIN_BOOTSTRAP_EMAIL` and `EDITOR_EMAIL` through protected environment configuration; do not send real identities in public chat/evidence. Bootstrap only after identities and Access allow policy are configured. |
| Dedicated cache-purge credential | `CACHE_PURGE_TOKEN` absent | Supply a protected token scoped to Cache Purge for the intended zone before authenticated publication/cache acceptance. Do not silently reuse the broader deployment token. |
| Images stats | HTTP 403, code `5403`: account not valid or not authorized for the service | Stats authorization/entitlement remains unresolved, but IMAGES binding deployment succeeded. Do not declare account activation required for transformations without a failing transformation test. Authenticated image variant/fallback acceptance is still pending. |

Issuer, application AUD, zone and test origin have been selected into ignored production configuration without printing production identifiers. Configure login method, explicit allowed identities and scoped purge credential next. Never infer the CMS Admin from the token owner's identity. See [Cloudflare operations](cloudflare.md#account-onboarding-and-preflight).

## Actions not performed

No hosted Images resource or Worker secret was created. No Admin bootstrap or production content import has occurred. The test application's deny policy will require a deliberate replacement with exact approved identities before authenticated workflows can pass.

Real Access browser login, Admin/Editor acceptance, image variant/fallback, two-edge warm-cache publication, a complete backup/restore with R2 inventory and published snapshots, and compatible Worker rollback rehearsal remain unverified. Workers Builds repository connection and account pricing/limits/Time Travel retention also remain to be verified.

DNS, GitHub Pages, Hugo/Decap and the legacy OAuth Worker are unchanged. Task 16 is gated on complete test-host acceptance and explicit user approval; preparing its [cutover checklist](cutover.md) does not authorize cutover.

## Evidence required before marking production passing

- Sanitized account/zone confirmation and current plan limits for Workers, D1, R2, Images, Cache API and Access.
- Ignored production config with binding/resource presence checks; no ID or identity committed.
- D1 migration and initial Admin bootstrap timestamps.
- Test-host Worker deployment ID and Access application coverage for `/admin`, `/api/admin`, `/preview` and aliases.
- Public smoke counts plus authenticated Admin/Editor E2E counts, with skipped count zero for the production acceptance run.
- Image variant/fallback result and warm-cache publish verified from two edge locations; record whether purge was `purged` or remained `pending`.
- Completed production backup manifest and restore rehearsal into fresh temporary resources, including D1 and R2 inventory verification.
- Compatible rollback deployment ID and UTC rehearsal result.

Do not place API tokens, JWTs, personal email, account IDs, zone IDs, database IDs or bucket credentials in this file.
