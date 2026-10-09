# Cloudflare operations runbook

## Scope and access

The production Worker needs D1 (`DB`), R2 (`MEDIA`), Cloudflare Images (`IMAGES`), static assets (`ASSETS`), Cloudflare Access issuer/audience, the canonical `SITE_ORIGIN`, zone ID, and a cache-purge token stored as a Worker secret. Never put account IDs, resource IDs, email addresses, API tokens, or R2 keys in Git.

Cloudflare Access must protect every path under `/admin`, `/api/admin`, and `/preview` on the test hostname and custom domain. A CMS invitation only creates a D1 authorization record; the operator must independently allow the same identity in the Access policy.

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
