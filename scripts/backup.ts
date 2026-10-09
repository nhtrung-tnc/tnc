export interface InventoryObject { key:string; size:number; etag:string }
export interface InventorySource {
  list(cursor?:string): Promise<{ objects:InventoryObject[]; cursor?:string }>;
}
export interface BackupObjectStore {
  put(key:string, value:Uint8Array): Promise<void>;
  get(key:string): Promise<Uint8Array | null>;
  head(key:string): Promise<unknown | null>;
  delete(key:string): Promise<void>;
  list(prefix:string, cursor?:string): Promise<{ keys:string[]; cursor?:string }>;
}
export interface RuntimeCredentials { accountId:string; apiToken?:string }
export interface BackupManifest {
  createdAt:string;
  schemaVersion:string;
  dbExportKey:string;
  r2InventoryKey:string;
  checksums:Record<string, string>;
  manifestKey:string;
}
export interface BackupConfig {
  target:"local" | "production";
  databaseId:string;
  databaseName:string;
  mediaBucketName:string;
  backupBucketName:string;
  schemaVersion:string;
  credentialProvider():Promise<RuntimeCredentials>;
  exportDatabase(credentials:RuntimeCredentials):Promise<Uint8Array>;
  media:InventorySource;
  backup:BackupObjectStore;
  now?:() => Date;
}

const encoder = new TextEncoder();

export async function sha256(bytes:Uint8Array):Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readInventory(source:InventorySource):Promise<InventoryObject[]> {
  const objects:InventoryObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await source.list(cursor);
    objects.push(...page.objects);
    cursor = page.cursor;
  } while (cursor);
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}

export function inventoryBytes(objects:InventoryObject[]):Uint8Array {
  return encoder.encode(JSON.stringify(objects));
}

export async function createBackup(config:BackupConfig):Promise<BackupManifest> {
  if (config.mediaBucketName === config.backupBucketName) {
    throw new TypeError("Backup bucket must be separate from the media bucket");
  }
  const credentials = await config.credentialProvider();
  const createdAt = (config.now?.() ?? new Date()).toISOString();
  const setId = createdAt.replaceAll(":", "-");
  const prefix = `backups/${setId}`;
  const dbExportKey = `${prefix}/database.sql`;
  const r2InventoryKey = `${prefix}/media-inventory.json`;
  const manifestKey = `${prefix}/manifest.json`;
  const database = await config.exportDatabase(credentials);
  await config.backup.put(dbExportKey, database);
  const inventory = inventoryBytes(await readInventory(config.media));
  await config.backup.put(r2InventoryKey, inventory);
  const manifest:BackupManifest = {
    createdAt,
    schemaVersion:config.schemaVersion,
    dbExportKey,
    r2InventoryKey,
    checksums:{ database:await sha256(database), inventory:await sha256(inventory) },
    manifestKey,
  };
  await config.backup.put(manifestKey, encoder.encode(JSON.stringify(manifest)));
  await retainCompleted(config.backup, 4);
  return manifest;
}

async function allKeys(store:BackupObjectStore, prefix:string):Promise<string[]> {
  const keys:string[] = [];
  let cursor:string | undefined;
  do {
    const page = await store.list(prefix, cursor);
    keys.push(...page.keys);
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

async function retainCompleted(store:BackupObjectStore, keep:number):Promise<void> {
  const keys = await allKeys(store, "backups/");
  const manifests = keys.filter((key) => key.endsWith("/manifest.json")).sort().reverse();
  for (const manifestKey of manifests.slice(keep)) {
    const prefix = manifestKey.slice(0, -"manifest.json".length);
    for (const key of keys.filter((candidate) => candidate.startsWith(prefix))) await store.delete(key);
  }
}
import { directInvocation, explicitTarget, failSafely, loadRuntimeConfig } from "./runtime-config";


if (directInvocation("backup.ts")) {
  void (async () => {
    const target = explicitTarget();
    const config = await loadRuntimeConfig<BackupConfig>();
    if (config.target !== target) throw new Error("Runtime config target does not match --target");
    const manifest = await createBackup(config);
    console.log(JSON.stringify({ createdAt:manifest.createdAt, manifestKey:manifest.manifestKey }));
  })().catch(failSafely);
}
