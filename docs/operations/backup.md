# Backup and restore rehearsal

## Backup model

Run `npm run backup -- --target production` weekly using a dedicated backup R2 bucket that is different from `MEDIA`. A set contains:

- a D1 SQL export;
- a paginated inventory of every media object (`key`, `size`, `etag`);
- SHA-256 checksums for both files;
- a manifest written last, which is the only completion marker.

The inventory is **not a backup of R2 object bytes**. Configure independent R2 retention/replication appropriate to the account, and verify that policy in Cloudflare. The script keeps the four newest completed sets. Partial failed sets have no manifest and never cause a previously completed set to be deleted.

Example operator invocation:

```bash
OPERATION_CONFIG_MODULE=file:///absolute/path/.operations.production.mjs \
  npm run backup -- --target production
```

The ignored config's `credentialProvider` obtains credentials at runtime. Its database exporter must use official Wrangler/Cloudflare D1 export; its inventory adapter must page the official R2 API/binding until the cursor is empty; its backup adapter writes the separate bucket. Tokens must never be returned in errors or logs.

## Weekly checklist

1. Confirm the selected account, database ID/name, media bucket, and separate backup bucket.
2. Run the backup and record only UTC time, manifest key, checksums, object count, and operator ticket.
3. Confirm the manifest exists and is newer than the two data objects.
4. Confirm four completed weekly manifests remain.
5. Run a restore rehearsal into newly created temporary D1/R2 resources; never overwrite production.

```bash
OPERATION_CONFIG_MODULE=file:///absolute/path/.operations.rehearsal.mjs \
  npm run restore:rehearsal -- --target production
```

The rehearsal validates both stored checksums, imports D1, verifies that published snapshots can be queried, then compares the full media inventory count and checksum. Destroy temporary rehearsal resources only after evidence is recorded.

## Recovery notes

- D1 point-in-time recovery depends on the retention shown for the actual Cloudflare plan. Record that value during each production review.
- To recover media soft-deleted less than 30 days ago, set its D1 status back to `active` only after checking the R2 object's checksum and ensuring no conflicting active checksum exists. After cleanup removes the R2 bytes, the inventory alone cannot restore them.
- If a backup fails, preserve its partial prefix for diagnosis until a new completed set exists; do not delete older completed sets.
- Restore to a fresh database first, validate schema/migrations and published route counts, then plan a controlled binding switch. Do not import directly into the live database during diagnosis.
