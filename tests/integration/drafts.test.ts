import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createItem,
  getDraft,
  listDrafts,
} from "../../src/server/content/repository";
import { saveDraft, saveShared } from "../../src/server/content/drafts";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor, makeInsight } from "../helpers/fixtures";

const actor = makeActor("editor");

async function createInsight(): Promise<string> {
  return createItem(env.DB, actor, "insight", "natural-materials");
}

describe("versioned drafts", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(actor);
  });

  it("creates all three locale drafts and enforces slug and singleton rules", async () => {
    const itemId = await createInsight();
    const locales = await env.DB.prepare(
      "SELECT locale FROM content_locales WHERE content_item_id = ? ORDER BY locale",
    )
      .bind(itemId)
      .all<{ locale: string }>();
    expect(locales.results.map(({ locale }) => locale)).toEqual(["en", "ja", "vi"]);

    await expect(
      createItem(env.DB, actor, "insight", "natural-materials"),
    ).rejects.toMatchObject({ status: 409 });
    await createItem(env.DB, actor, "homepage", "home");
    await expect(
      createItem(env.DB, actor, "homepage", "another-home"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("saves one locale without changing the other locales", async () => {
    const itemId = await createInsight();
    const vi = makeInsight().data;
    vi.title = "Vật liệu tự nhiên";
    const saved = await saveDraft(env.DB, actor, itemId, "vi", 1, vi);

    expect(saved.version).toBe(2);
    expect(saved.snapshot.type).toBe("insight");
    if (saved.snapshot.type !== "insight") throw new Error("Expected insight draft");
    expect(saved.snapshot.data.title).toBe("Vật liệu tự nhiên");
    expect((await getDraft(env.DB, itemId, "en")).version).toBe(1);
    expect((await getDraft(env.DB, itemId, "ja")).version).toBe(1);
  });

  it("allows only one concurrent save for the same expected version", async () => {
    const itemId = await createInsight();
    const first = makeInsight().data;
    first.title = "First";
    const second = makeInsight().data;
    second.title = "Second";

    const results = await Promise.allSettled([
      saveDraft(env.DB, actor, itemId, "vi", 1, first),
      saveDraft(env.DB, actor, itemId, "vi", 1, second),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: { status: 409 } });
    const saves = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'draft.save'",
    ).first<{ count: number }>();
    expect(saves?.count).toBe(1);
  });

  it("versions shared data without creating a public revision", async () => {
    const itemId = await createInsight();
    await seedMedia("hero-media");

    const version = await saveShared(env.DB, actor, itemId, 1, {
      primaryMediaId: "hero-media",
    });
    expect(version).toBe(2);
    await expect(
      saveShared(env.DB, actor, itemId, 1, { primaryMediaId: null }),
    ).rejects.toMatchObject({ status: 409 });

    const revisions = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM content_revisions",
    ).first<{ count: number }>();
    expect(revisions?.count).toBe(0);
  });

  it("synchronizes draft media references and rejects unavailable media", async () => {
    const itemId = await createInsight();
    await seedMedia("active-media");
    const data = makeInsight().data;
    data.seo.image = { mediaId: "active-media", alt: "SEO" };
    await saveDraft(env.DB, actor, itemId, "vi", 1, data);

    const draft = await getDraft(env.DB, itemId, "vi");
    const refs = await env.DB.prepare(
      "SELECT media_id FROM media_references WHERE owner_kind = 'draft' AND owner_id = ?",
    )
      .bind(`${itemId}:vi`)
      .all<{ media_id: string }>();
    expect(refs.results.map(({ media_id }) => media_id)).toEqual(["active-media"]);

    const invalid = makeInsight().data;
    invalid.seo.image = { mediaId: "missing-media", alt: "Missing" };
    await expect(
      saveDraft(env.DB, actor, itemId, "vi", draft.version, invalid),
    ).rejects.toMatchObject({ status: 422 });

    await env.DB.prepare("UPDATE media SET status = 'deleted' WHERE id = 'active-media'").run();
    await expect(
      saveDraft(env.DB, actor, itemId, "vi", draft.version, data),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("records compact audit events and exposes dashboard status", async () => {
    const itemId = await createInsight();
    await saveDraft(env.DB, actor, itemId, "vi", 1, makeInsight().data);

    const audits = await env.DB.prepare(
      "SELECT action, metadata_json FROM audit_events ORDER BY created_at",
    ).all<{ action: string; metadata_json: string }>();
    expect(audits.results.map(({ action }) => action)).toEqual([
      "content.create",
      "draft.save",
    ]);
    expect(audits.results.every(({ metadata_json }) => metadata_json === "{}")).toBe(true);

    const dashboard = await listDrafts(env.DB);
    expect(dashboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId,
          locale: "vi",
          version: 2,
          updatedBy: actor.id,
          publishedRevisionId: null,
        }),
      ]),
    );
  });
});

async function seedMedia(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO media
     (id, r2_key, original_filename, mime_type, byte_size, checksum_sha256, status, uploaded_by)
     VALUES (?, ?, 'image.jpg', 'image/jpeg', 100, ?, 'active', ?)`,
  )
    .bind(id, `media/${id}`, `checksum-${id}`, actor.id)
    .run();
}
