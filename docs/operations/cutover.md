# TNC cutover and rollback checklist

Status: **preparation only; cutover is not authorized**. The test Worker is deployed and unauthenticated smoke passes, but authenticated acceptance and full recovery/cache checks remain blocked as recorded in [deployment evidence](deployment-evidence.md). DNS, GitHub Pages and Hugo/Decap remain active and unchanged.

## Acceptance gate

- [ ] Confirm actual Workers/D1/R2/Images/Access limits, pricing and D1 Time Travel retention.
- [ ] Record the protected test URL, Worker deployment/version and compatible rollback version in sanitized evidence.
- [ ] Verify Access coverage of `/admin`, `/api/admin`, `/preview`, root paths, descendants and aliases; protect or disable alternate Worker hostnames.
- [ ] Verify public smoke and real Access Admin/Editor browser tests, with zero skipped production acceptance tests.
- [ ] Verify draft isolation, independent VI/EN/JA publishing, preview, immutable revisions, restore-to-draft and role restrictions.
- [ ] Verify upload authorization, private media, image variants and fallback.
- [ ] Warm caches, publish, then verify new content from at least two edge locations; record `purged` versus `pending` honestly.
- [ ] Complete production D1/R2 inventory backup and restore rehearsal into fresh temporary resources, with schema, published snapshot, counts and checksums verified. An inventory is not a backup of media bytes.
- [ ] Rehearse compatible Worker rollback and confirm schema compatibility; preserve resources until evidence is recorded.
- [ ] Verify Workers Builds connection and prevent deployment from an unapproved branch or local/test config.

## Explicit user approval

Present completed evidence, remaining risks, exact proposed DNS/Worker routing and Pages changes, and rollback steps. Obtain explicit user confirmation **before DNS cutover or disabling the old system**. A successful local suite or test-host smoke alone does not grant this approval.

## Approved cutover sequence

1. Save the existing DNS records, Pages settings, legacy OAuth routing and recovery Git ref in protected operator storage. Do not commit identifiers or identities.
2. Verify the new domain's Access configuration and TLS before public traffic reaches the Worker. Resolve hostname ownership and `www` canonical routing explicitly.
3. Apply only the approved `tnchandicraft.com` routing/DNS changes to the validated Worker version. Keep Pages available for rollback.
4. Run public and private-route smoke, real Admin/Editor workflows, media/SEO/draft isolation and publish/cache checks on the canonical domain. Monitor errors and 404s.
5. If any private route fails closed checks, immediately revert the new Worker routing to the saved working route. Investigate before retrying.
6. Only after canonical-domain verification and within the user's approved scope, disable legacy Pages deployment/serving and retire the OAuth route after verifying it has no remaining consumer.
7. Record a recovery commit before removing the plan's listed Hugo/Decap files; preserve unrelated files and user changes. Do not import legacy content automatically.
8. Run the full suite and canonical-domain smoke after cleanup; record sanitized evidence and the weekly backup schedule. Commit and push to the migration branch.

## Rollback

Restore the saved DNS/route/Pages state if the domain handoff fails. For Worker code rollback, select the recorded compatible version and keep the expanded D1 schema intact. Do not overwrite production D1 or delete R2 objects as part of a code rollback. Restore data into a fresh database first and validate it before any binding change. Pause cleanup during storage incidents; retain legacy recovery refs and rehearsal evidence.
