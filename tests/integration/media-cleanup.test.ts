import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveDraft } from "../../src/server/content/drafts";
import { createItem } from "../../src/server/content/repository";
import { cleanupMedia, softDeleteMedia } from "../../src/server/media/cleanup";
import { uploadMedia } from "../../src/server/media/upload";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor, makeInsight } from "../helpers/fixtures";

const admin = makeActor("admin");
const now = new Date("2026-10-09T00:00:00.000Z");

describe("media cleanup", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(admin);
  });

  it("refuses to soft-delete media referenced by a draft", async () => {
    const media = await uploadMedia(env, admin, imageFile());
    const itemId = await createItem(env.DB, admin, "insight", "referenced");
    const data = makeInsight().data;
    data.seo.image = { mediaId: media.id, alt: "Referenced" };
    await saveDraft(env.DB, admin, itemId, "vi", 1, data);
    await expect(softDeleteMedia(env, admin, media.id)).rejects.toMatchObject({ status: 409 });
  });

  it("skips 29 days and deletes at 30 days when checksums match", async () => {
    const media = await uploadMedia(env, admin, imageFile());
    await softDeleteMedia(env, admin, media.id);
    await setDeletedAt(media.id, "2026-09-10T00:00:01.000Z");
    expect(await cleanupMedia(env, now)).toEqual({ deleted: 0, skipped: 1 });
    expect(await env.MEDIA.head(media.r2Key)).not.toBeNull();

    await setDeletedAt(media.id, "2026-09-09T00:00:00.000Z");
    expect(await cleanupMedia(env, now)).toEqual({ deleted: 1, skipped: 0 });
    expect(await env.MEDIA.head(media.r2Key)).toBeNull();
  });

  it("skips and quarantines an object whose R2 checksum mismatches D1", async () => {
    const media = await uploadMedia(env, admin, imageFile());
    await softDeleteMedia(env, admin, media.id);
    await setDeletedAt(media.id, "2026-09-01T00:00:00.000Z");
    await env.MEDIA.put(media.r2Key, new Uint8Array([1, 2, 3]), {
      customMetadata: { checksumSha256: "different", status: "active" },
    });

    expect(await cleanupMedia(env, now)).toEqual({ deleted: 0, skipped: 1 });
    expect(await env.MEDIA.head(media.r2Key)).not.toBeNull();
    const row = await env.DB.prepare("SELECT status FROM media WHERE id = ?")
      .bind(media.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("orphaned");
  });
});

async function setDeletedAt(id: string, value: string): Promise<void> {
  await env.DB.prepare("UPDATE media SET deleted_at = ? WHERE id = ?").bind(value, id).run();
}

function imageFile(): File {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, 100);
  new DataView(bytes.buffer).setUint32(20, 80);
  bytes.set([73, 69, 78, 68], 37);
  return new File([bytes], "image.png", { type: "image/png" });
}
