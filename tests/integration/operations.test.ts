import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../../scripts/bootstrap-admin";
import { createBackup, type BackupObjectStore, type InventorySource } from "../../scripts/backup";
import { restoreRehearsal } from "../../scripts/restore-rehearsal";
import { resetDatabase } from "../helpers/database";

describe("Admin bootstrap", () => {
  beforeEach(resetDatabase);

  it("creates only the first Admin and is idempotent for the same normalized email", async () => {
    const id = await bootstrapAdmin(env.DB, " First.Admin@Example.com ");
    expect(await bootstrapAdmin(env.DB, "first.admin@example.com")).toBe(id);
    await expect(bootstrapAdmin(env.DB, "other@example.com")).rejects.toMatchObject({ status:409 });
    const row = await env.DB.prepare("SELECT email_normalized, role, active FROM users").first();
    expect(row).toEqual({ email_normalized:"first.admin@example.com", role:"admin", active:1 });
  });
});

describe("backup and restore operations", () => {
  it("exports D1, inventories more than 1000 R2 objects, and verifies checksums", async () => {
    const backup = new MemoryStore();
    const media = inventory(1005);
    const manifest = await createBackup(config(backup, media, new Date("2026-10-01T00:00:00Z")));
    expect(manifest.schemaVersion).toBe("0001");
    expect(manifest.checksums.database).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.checksums.inventory).toMatch(/^[a-f0-9]{64}$/);
    expect(await backup.head(manifest.dbExportKey)).not.toBeNull();
    expect(await backup.head(manifest.r2InventoryKey)).not.toBeNull();
    expect(media.calls).toBe(2);

    let imported = "";
    const restored = await restoreRehearsal({
      target:"local",
      manifestKey:manifest.manifestKey,
      backupBucketName:"backup-test",
      mediaBucketName:"media-test",
      credentialProvider:async () => ({ accountId:"test" }),
      backup,
      media,
      importDatabase:async (bytes) => { imported = new TextDecoder().decode(bytes); },
      verifyDatabase:async () => imported.includes("published_routes"),
    });
    expect(restored).toEqual({ dbVerified:true, inventoryVerified:true });
  });

  it("retains four completed sets and a failed backup keeps them", async () => {
    const backup = new MemoryStore();
    const media = inventory(2);
    for (let day = 1; day <= 5; day++) {
      await createBackup(config(backup, media, new Date(`2026-10-0${day}T00:00:00Z`)));
    }
    expect(backup.keys().filter((key) => key.endsWith("manifest.json"))).toHaveLength(4);
    const previous = [...backup.keys()];
    const failing: InventorySource = { list:async () => { throw new Error("inventory unavailable"); } };
    await expect(createBackup(config(backup, failing, new Date("2026-10-06T00:00:00Z")))).rejects.toThrow();
    for (const key of previous) expect(await backup.head(key)).not.toBeNull();
  });
});

function config(backup: MemoryStore, media: InventorySource, now: Date) {
  return {
    target:"local" as const,
    databaseId:"db-test",
    databaseName:"cms-test",
    mediaBucketName:"media-test",
    backupBucketName:"backup-test",
    schemaVersion:"0001",
    credentialProvider:async () => ({ accountId:"test" }),
    exportDatabase:async () => new TextEncoder().encode("CREATE TABLE published_routes(id TEXT);"),
    media,
    backup,
    now:() => now,
  };
}

function inventory(count: number): InventorySource & { calls:number } {
  const source = {
    calls:0,
    async list(cursor?: string) {
      source.calls++;
      const start = cursor ? Number(cursor) : 0;
      const end = Math.min(start + 1000, count);
      return {
        objects:Array.from({ length:end - start }, (_, offset) => ({
          key:`media/${String(start + offset).padStart(4, "0")}.png`,
          size:100 + start + offset,
          etag:`etag-${start + offset}`,
        })),
        cursor:end < count ? String(end) : undefined,
      };
    },
  };
  return source;
}

class MemoryStore implements BackupObjectStore {
  #objects = new Map<string, Uint8Array>();
  async put(key:string, value:Uint8Array) { this.#objects.set(key, value.slice()); }
  async get(key:string) { return this.#objects.get(key)?.slice() ?? null; }
  async head(key:string) { return this.#objects.has(key) ? { key } : null; }
  async delete(key:string) { this.#objects.delete(key); }
  async list(prefix:string, cursor?:string) {
    const keys = [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 1000, keys.length);
    return { keys:keys.slice(start, end), cursor:end < keys.length ? String(end) : undefined };
  }
  keys() { return [...this.#objects.keys()]; }
}
