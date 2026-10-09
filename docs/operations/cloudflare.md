# Cloudflare operations runbook

## Scope and access

The production Worker needs D1 (`DB`), R2 (`MEDIA`), Cloudflare Images (`IMAGES`), static assets (`ASSETS`), Cloudflare Access issuer/audience, the canonical `SITE_ORIGIN`, zone ID, and a cache-purge token stored as a Worker secret. Never put account IDs, resource IDs, email addresses, API tokens, or R2 keys in Git.

Cloudflare Access must protect every path under `/admin`, `/api/admin`, and `/preview` on the test hostname and custom domain. A CMS invitation only creates a D1 authorization record; the operator must independently allow the same identity in the Access policy.

## Account onboarding and preflight

Before provisioning, run `environment_status`, check credential presence without printing values, and run `XDG_CONFIG_HOME=.tool-config npx wrangler whoami` with raw identity output kept private. API success is the authorization evidence; a runtime readiness state of `unknown` is not proof of readiness.

Locate `tnc-cms-production` by name through the D1 API and reuse it. Select its identifier programmatically into ignored local configuration. Inspect applied migrations before changing schema; never recreate the database just because the local production config is absent. Do not copy account/resource identifiers or real identities into this runbook.

Account owners must resolve account activation blockers in the dashboard:

1. **R2:** select the deployment account, open **R2 Object Storage**, and complete **Get started/Enable R2**, including any subscription and payment requirements displayed. API code `10042` explicitly requires dashboard activation. Do not try to bypass this by requesting broader token permissions.
2. **Zero Trust/Access:** open **Zero Trust**, select **Get started/Enable Access**, choose the unique team name, choose the subscription plan and complete billing/onboarding. Cloudflare's onboarding documentation requires payment details even for the Free plan. API `access.api.error.not_enabled` remains a blocker until onboarding completes.
3. **Access login:** choose the login method (the default Cloudflare identity provider, email one-time PIN, or the organization's IdP). Add exact allowed Admin/Editor identities separately from their D1 roles. Provide initial identities through protected local/runtime configuration, not Git or public evidence.
4. **Images:** review the account's Images/Transformations availability and pricing. Stats API code `5403` can represent unavailable service entitlement or authorization/account scope; do not claim a unique cause. This app passes R2 bytes to an Images binding, rather than storing media in hosted Images. Binding configuration alone does not prove production image transformations pass.

Use narrowly scoped Account permissions on the deployment account: `D1: Edit`, `Workers R2 Storage: Edit`, `Cloudflare Images: Read` for the stats preflight, `Access: Apps and Policies: Edit`, and `Access: Organizations: Read`. Add `Access: Identity Providers: Edit` only if automation configures the login provider; organization/group edit permissions are only needed for their corresponding mutations. Dashboard `Edit` is often named `Write` in API permission groups. Do not grant all-account or broad Zero Trust permissions merely to work around activation errors.

The API token's R2 permissions and optional S3-compatible object credentials are different. Bucket provisioning uses the Cloudflare REST API; runtime Worker media access uses its R2 binding. Do not embed S3 credentials in the Worker.

After activation, create distinct media and backup buckets, enable `IMAGES`, and configure an Access application covering private roots, their descendants and aliases on the selected test hostname. Match the app's Cloudflare-generated AUD to `ACCESS_AUDIENCE` and organization auth domain to `ACCESS_ISSUER`. The current app expects one audience. Disable alternate public Worker hostnames unless they receive the same intended protection. Keep public locale routes accessible for smoke testing.

Before deploying, record actual account limits/pricing and Time Travel retention, resolve the canonical test origin, and provide the cache-purge credential as a Worker secret. Do not substitute test placeholders for production issuer/audience or select the initial Admin from the token owner's email. Recheck all API preflights after the owner reports activation complete.

References: [Zero Trust onboarding](https://developers.cloudflare.com/cloudflare-one/setup/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/), [Images binding](https://developers.cloudflare.com/images/optimization/binding/).

## Safe initialization

Every operational command requires both an explicit `--target local|production` and a `file://` module in `OPERATION_CONFIG_MODULE`. The ignored runtime module supplies concrete D1/R2 adapters and a credential provider backed by the official Wrangler or Cloudflare API. The target inside that module must match the CLI argument.

```bash
OPERATION_CONFIG_MODULE=file:///absolute/path/.operations.production.mjs \
  npm run admin:bootstrap -- --target production
```

The bootstrap module receives the initial email from a protected environment variable or operator prompt. The command never prints it. It succeeds only when there is no Admin, is idempotent for the same normalized email, and refuses a different identity.

## Schema changes

Use expand → migrate → contract:

1. Export/backup and run a restore rehearsal.
2. Add backward-compatible tables/columns/indexes.
3. Deploy code that can read both shapes and writes the expanded shape.
4. Backfill in bounded, restartable batches and verify counts.
5. Deploy code that reads only the new shape.
6. Remove old fields in a later release after the rollback window.

Apply D1 migrations before code that requires them. Never contract in the same release as expansion. Confirm the real account plan's D1 Time Travel retention immediately before deployment; record the displayed retention rather than assuming a duration from this repository.

## Incidents and rollback

- Capture the `Cf-Ray`/request ID, UTC timestamp, route, deployment ID, and sanitized error code. Do not copy Access JWTs, query credentials, or personal email into tickets.
- `cacheStatus: pending` means publication committed but global purge was not proven. Re-run purge with the scoped token and verify from at least two edge locations; do not treat one local Cache API deletion as global purge.
- Roll back Worker code to a recorded compatible deployment. D1 revisions are immutable, so a code rollback must remain compatible with the current expanded schema.
- If private routes do not fail closed, remove custom-domain routing to the new Worker immediately and restore the last known-good route before investigation.
- Cron media cleanup is daily. A soft-deleted object is retained for 30 days unless it has become orphaned; pause cleanup during a storage incident.

Production resource creation, Access policy changes, migration, deployment, and DNS cutover require separate deployment evidence and are not performed by CI.

## Production config and smoke

Copy the binding shape from `wrangler.jsonc` into ignored `.wrangler.production.jsonc`, then replace only through Cloudflare's resource selection/output: Worker name, real D1 database ID/name, MEDIA bucket name, Access issuer/audience, canonical origin, zone ID and Cron. Put `CACHE_PURGE_TOKEN` with `wrangler secret put`; never add it to `vars`.

Deploy the actual Astro build output: `main: "dist/server/entry.mjs"`, assets directory `dist/client`, `no_bundle: true`, ESModule rules for `**/*.js` and `**/*.mjs`, and `find_additional_modules: true`. Omitting module rules caused Cloudflare validation error `10021` for missing Astro chunks in the first production upload. Configure `images: { binding: "IMAGES" }` and disable preview URLs unless equivalent Access coverage is verified. Keep all concrete IDs/AUDs in the ignored config.

```bash
npm run build
npm run deploy:production
npm run smoke:production -- --origin https://protected-test-host.example.workers.dev
```

In this managed environment, use `NODE_USE_ENV_PROXY=1 npm run smoke:production -- --origin <test-origin>` so Node fetch uses the configured network proxy. Preserve TLS verification and inherited proxy/CA settings. Never treat a transport error or generic edge denial as proof of private-route Access protection; inspect the redirect target and public-route behavior.

Before deployment, verify the account's current Workers, D1, R2, Images, Cache API and Access limits/pricing in the dashboard. Disable the public `workers.dev` hostname unless it is itself covered by the intended Access application; a private route protected only on the custom domain is insufficient.

The unauthenticated smoke proves public routes and that private roots are not public. Complete Admin and Editor browser tests through the real Access login, then test draft isolation, image variants/fallback and cache purge from at least two edge locations. Record only sanitized evidence.
