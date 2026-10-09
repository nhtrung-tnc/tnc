import {
  inventoryBytes,
  readInventory,
  sha256,
  type BackupManifest,
  type BackupObjectStore,
  type InventorySource,
  type RuntimeCredentials,
} from "./backup";
import { directInvocation, explicitTarget, failSafely, loadRuntimeConfig } from "./runtime-config";

export interface RestoreConfig {
  target:"local" | "production";
  manifestKey:string;
  mediaBucketName:string;
  backupBucketName:string;
  credentialProvider():Promise<RuntimeCredentials>;
  backup:BackupObjectStore;
  media:InventorySource;
  importDatabase(bytes:Uint8Array, credentials:RuntimeCredentials):Promise<void>;
  verifyDatabase():Promise<boolean>;
}

export async function restoreRehearsal(
  config:RestoreConfig,
):Promise<{ dbVerified:boolean; inventoryVerified:boolean }> {
  if (config.mediaBucketName === config.backupBucketName) {
    throw new TypeError("Backup bucket must be separate from the media bucket");
  }
  const credentials = await config.credentialProvider();
  const encodedManifest = await config.backup.get(config.manifestKey);
  if (!encodedManifest) throw new Error("Backup manifest was not found");
  const manifest = JSON.parse(new TextDecoder().decode(encodedManifest)) as BackupManifest;
  const database = await config.backup.get(manifest.dbExportKey);
  const expectedInventory = await config.backup.get(manifest.r2InventoryKey);
  if (!database || !expectedInventory) throw new Error("Backup set is incomplete");
  if (await sha256(database) !== manifest.checksums.database) throw new Error("D1 export checksum mismatch");
  if (await sha256(expectedInventory) !== manifest.checksums.inventory) throw new Error("Inventory checksum mismatch");
  await config.importDatabase(database, credentials);
  const dbVerified = await config.verifyDatabase();
  const actualInventory = inventoryBytes(await readInventory(config.media));
  const inventoryVerified = await sha256(actualInventory) === manifest.checksums.inventory;
  return { dbVerified, inventoryVerified };
}

if (directInvocation("restore-rehearsal.ts")) {
  void (async () => {
    const target = explicitTarget();
    const config = await loadRuntimeConfig<RestoreConfig>();
    if (config.target !== target) throw new Error("Runtime config target does not match --target");
    console.log(JSON.stringify(await restoreRehearsal(config)));
  })().catch(failSafely);
}
