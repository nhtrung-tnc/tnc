# Cloudflare deployment evidence

Status: **Task 15 partially provisioned; production acceptance blocked by account onboarding**.

Rechecked at 2026-10-09 13:24 UTC (20:24 Asia/Saigon), starting from handoff commit `b76cdd0f450eb6282d3fb5fe6873439a44e42d96` on `codex/astro-cloudflare-migration`. Remote branch was fetched and fast-forward checked; existing work was preserved. This evidence supersedes the earlier unauthenticated status.

## Verified state

- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are present; their values were not printed. `environment_status` reports current observations but readiness `unknown`, so readiness is established only for the API calls that actually succeeded.
- Wrangler 4.149.0 `whoami` authenticated successfully. Raw identity output was kept out of published evidence.
- Existing production D1 `tnc-cms-production` was located and reused; no duplicate database was created. Migration `0001_cms.sql` was already applied and was not reapplied. Remote schema verification found nine CMS tables, one applied migration, zero users and zero content items.
- Resource identifiers are selected programmatically into ignored `.operations.d1.jsonc`; no production identifier is committed. This is a D1 operations config, not a deployable production Worker config.
- `npm ci`, `npm run check` and `npm run verify` exited successfully: 16 unit tests and 87 integration tests passed; browser E2E had six passed and **seven skipped**. The skipped Admin/Editor/publishing tests require Access JWTs and an item fixture. Exit zero with skips is **not production acceptance**.
- Operations integration tests exercise initial Admin bootstrap, backup pagination over 1,005 synthetic media objects, checksums, retention of four completed sets, failure preservation and restore verification using test adapters. These are not a real production backup or restore rehearsal.
- Local Astro build and Wrangler deploy dry-run passed. Dry-run used local/test bindings and created no deployment.

## Remaining blockers

| API check | Observed result | Required next action |
| --- | --- | --- |
| D1 database list/query | Successful | Reuse the existing database; confirm actual plan and Time Travel retention before deployment. |
| R2 bucket list | HTTP 403, code `10042`: `Please enable R2 through the Cloudflare Dashboard.` | Account owner must complete R2 dashboard activation/billing before bucket creation. |
| Access organization and applications | HTTP 403, code `9999`: `access.api.error.not_enabled` | Complete Zero Trust/Access dashboard onboarding, including team name, plan and billing. |
| Images stats | HTTP 403, code `5403`: account not valid or not authorized for the service | Check Images service entitlement/activation and token account scope. This response does not distinguish the causes and does not prove Images binding cannot work. |

After onboarding, configure login method and explicit allowed identities, then select issuer, application AUD, test hostname, initial Admin and Editor identities and a scoped cache-purge credential through protected configuration. Never infer the CMS Admin from the token owner's identity. See [Cloudflare operations](cloudflare.md#account-onboarding-and-preflight).

## Actions not performed

No R2 media/backup bucket, Access application/policy, hosted Images resource, Worker secret or Worker deployment was created. The only production resource created during this session's earlier phase was D1 `tnc-cms-production`, with its initial migration. No Admin bootstrap or production content import has occurred.

**Test URL: not available.** Real Access browser login, Admin/Editor acceptance, image variant/fallback, two-edge warm-cache publication, production backup/restore and compatible rollback rehearsal remain unverified. Workers Builds repository connection and account pricing/limits also remain to be verified.

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
