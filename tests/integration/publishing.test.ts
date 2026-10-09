import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveDraft } from "../../src/server/content/drafts";
import {
  publishLocale,
  saveItemMetadata,
} from "../../src/server/content/publish";
import { getDraft, createItem } from "../../src/server/content/repository";
import { restoreRevision } from "../../src/server/content/restore";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor, makeInsight } from "../helpers/fixtures";

const admin = makeActor("admin");
const editor = makeActor("editor");

describe("publishing and restoring locale revisions", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(admin);
    await seedActor(editor);
  });

  async function preparedInsight(slug = "first-slug") {
    const itemId = await createItem(env.DB, admin, "insight", slug);
    await saveDraft(env.DB, admin, itemId, "vi", 1, makeInsight().data);
    return itemId;
  }

  it("publishes only one locale as an immutable snapshot", async () => {
    const itemId = await preparedInsight();
    const published = await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    expect(published.affectedPaths).toEqual(
      expect.arrayContaining([
        "/vi/insights/first-slug/",
        "/vi/insights/",
        "/vi/",
        "/sitemap.xml",
      ]),
    );

    const locales = await env.DB.prepare(
      "SELECT locale, draft_version, published_revision_id FROM content_locales WHERE content_item_id = ? ORDER BY locale",
    )
      .bind(itemId)
      .all<{
        locale: string;
        draft_version: number;
        published_revision_id: string | null;
      }>();
    expect(locales.results.find(({ locale }) => locale === "vi")).toMatchObject({
      draft_version: 3,
      published_revision_id: published.revisionId,
    });
    expect(
      locales.results.filter(({ locale }) => locale !== "vi").every(({ published_revision_id }) => published_revision_id === null),
    ).toBe(true);

    const revision = await env.DB.prepare(
      "SELECT data_json FROM content_revisions WHERE id = ?",
    )
      .bind(published.revisionId)
      .first<{ data_json: string }>();
    expect(JSON.parse(revision!.data_json)).toMatchObject({
      slug: "first-slug",
      shared: { primaryMediaId: null },
      data: { title: "Natural materials" },
    });
    await expect(
      env.DB.prepare("UPDATE content_revisions SET data_json = '{}' WHERE id = ?")
        .bind(published.revisionId)
        .run(),
    ).rejects.toThrow();
  });

  it("allows administrators only and accepts one concurrent publish", async () => {
    const itemId = await preparedInsight();
    await expect(
      publishLocale(env.DB, editor, itemId, "vi", 2, 1),
    ).rejects.toMatchObject({ status: 403 });

    const results = await Promise.allSettled([
      publishLocale(env.DB, admin, itemId, "vi", 2, 1),
      publishLocale(env.DB, admin, itemId, "vi", 2, 1),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM content_revisions WHERE content_locale_id = ?",
    )
      .bind(`${itemId}:vi`)
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("rolls the whole publish back when audit insertion fails", async () => {
    const itemId = await preparedInsight();
    await env.DB.prepare(`CREATE TRIGGER audit_fail BEFORE INSERT ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit failed'); END`).run();

    await expect(
      publishLocale(env.DB, admin, itemId, "vi", 2, 1),
    ).rejects.toBeDefined();
    const revisionCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM content_revisions",
    ).first<{ count: number }>();
    expect(revisionCount?.count).toBe(0);
    expect((await getDraft(env.DB, itemId, "vi")).publishedRevisionId).toBeNull();
  });

  it("restores a revision to a new draft without changing publication", async () => {
    const itemId = await preparedInsight();
    const first = await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    const changed = makeInsight().data;
    changed.title = "Changed draft";
    await saveDraft(env.DB, admin, itemId, "vi", 3, changed);

    await expect(
      restoreRevision(env.DB, editor, itemId, "vi", first.revisionId, 4, 1),
    ).rejects.toMatchObject({ status: 403 });

    const restored = await restoreRevision(
      env.DB,
      admin,
      itemId,
      "vi",
      first.revisionId,
      4,
      1,
    );
    expect(restored.version).toBe(5);
    expect(restored.publishedRevisionId).toBe(first.revisionId);
    expect(restored.snapshot.type).toBe("insight");
    if (restored.snapshot.type !== "insight") throw new Error("Expected insight");
    expect(restored.snapshot.data.title).toBe("Natural materials");

    const source = await env.DB.prepare(
      "SELECT draft_source_revision_id FROM content_locales WHERE id = ?",
    )
      .bind(`${itemId}:vi`)
      .first<{ draft_source_revision_id: string | null }>();
    expect(source?.draft_source_revision_id).toBe(first.revisionId);
  });

  it("rejects restoring a revision from another item or locale", async () => {
    const firstItem = await preparedInsight("first");
    const secondItem = await preparedInsight("second");
    const revision = await publishLocale(env.DB, admin, firstItem, "vi", 2, 1);

    await expect(
      restoreRevision(env.DB, admin, secondItem, "vi", revision.revisionId, 2, 1),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      restoreRevision(env.DB, admin, firstItem, "en", revision.revisionId, 1, 1),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("activates slugs per locale and flattens redirect chains", async () => {
    const itemId = await preparedInsight("a");
    await saveDraft(env.DB, admin, itemId, "en", 1, makeInsight().data);
    await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    await publishLocale(env.DB, admin, itemId, "en", 2, 1);

    await saveItemMetadata(env.DB, admin, itemId, 1, "b", { primaryMediaId: null });
    expect(await routePath(itemId, "vi")).toBe("/vi/insights/a/");
    expect(await routePath(itemId, "en")).toBe("/en/insights/a/");
    await publishLocale(env.DB, admin, itemId, "vi", 3, 2);
    expect(await routePath(itemId, "vi")).toBe("/vi/insights/b/");
    expect(await routePath(itemId, "en")).toBe("/en/insights/a/");

    await saveItemMetadata(env.DB, admin, itemId, 2, "c", { primaryMediaId: null });
    await publishLocale(env.DB, admin, itemId, "vi", 4, 3);
    const redirects = await env.DB.prepare(
      "SELECT old_path, new_path FROM redirects WHERE locale = 'vi' ORDER BY old_path",
    ).all<{ old_path: string; new_path: string }>();
    expect(redirects.results).toEqual([
      { old_path: "/vi/insights/a/", new_path: "/vi/insights/c/" },
      { old_path: "/vi/insights/b/", new_path: "/vi/insights/c/" },
    ]);
  });

  it("keeps shared image and slug drafts out of the published snapshot", async () => {
    const itemId = await preparedInsight("public-slug");
    const published = await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    await seedMedia("draft-image");
    await saveItemMetadata(env.DB, admin, itemId, 1, "draft-slug", {
      primaryMediaId: "draft-image",
    });

    const revision = await env.DB.prepare(
      "SELECT data_json FROM content_revisions WHERE id = ?",
    )
      .bind(published.revisionId)
      .first<{ data_json: string }>();
    expect(JSON.parse(revision!.data_json)).toMatchObject({
      slug: "public-slug",
      shared: { primaryMediaId: null },
    });
    expect(await routePath(itemId, "vi")).toBe("/vi/insights/public-slug/");

    const next = await publishLocale(env.DB, admin, itemId, "vi", 3, 2);
    const mediaRef = await env.DB.prepare(
      "SELECT media_id FROM media_references WHERE owner_kind = 'revision' AND owner_id = ?",
    )
      .bind(next.revisionId)
      .first<{ media_id: string }>();
    expect(mediaRef?.media_id).toBe("draft-image");
  });
});

async function routePath(itemId: string, locale: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT path FROM published_routes WHERE item_id = ? AND locale = ?",
  )
    .bind(itemId, locale)
    .first<{ path: string }>();
  return row?.path ?? null;
}

async function seedMedia(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO media
     (id, r2_key, original_filename, mime_type, byte_size, checksum_sha256, status, uploaded_by)
     VALUES (?, ?, 'image.jpg', 'image/jpeg', 100, ?, 'active', ?)`,
  )
    .bind(id, `media/${id}`, `checksum-${id}`, admin.id)
    .run();
}
