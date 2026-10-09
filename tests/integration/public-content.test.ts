import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveDraft } from "../../src/server/content/drafts";
import { publishLocale, saveItemMetadata } from "../../src/server/content/publish";
import { createItem } from "../../src/server/content/repository";
import {
  getPublished,
  listPublished,
  resolveRedirect,
} from "../../src/server/site/queries";
import { createPurger } from "../../src/server/site/cache";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor, makeInsight, makeSettings } from "../helpers/fixtures";

const admin = makeActor("admin");

describe("published content queries", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(admin);
  });

  it("never exposes an unpublished draft or later draft edits", async () => {
    const itemId = await createItem(env.DB, admin, "insight", "published-slug");
    const first = makeInsight().data;
    first.title = "Published title";
    await saveDraft(env.DB, admin, itemId, "vi", 1, first);
    expect(await getPublished(env.DB, "vi", "/vi/insights/published-slug/")).toBeNull();

    const result = await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    const changed = makeInsight().data;
    changed.title = "Private draft title";
    await saveDraft(env.DB, admin, itemId, "vi", 3, changed);
    await saveItemMetadata(env.DB, admin, itemId, 1, "draft-slug", {
      primaryMediaId: null,
    });

    const published = await getPublished(
      env.DB,
      "vi",
      "/vi/insights/published-slug/",
    );
    expect(published?.revisionId).toBe(result.revisionId);
    expect(published?.snapshot.slug).toBe("published-slug");
    expect(published?.snapshot.type).toBe("insight");
    if (published?.snapshot.type !== "insight") throw new Error("Expected insight");
    expect(published.snapshot.data.title).toBe("Published title");
    expect(await getPublished(env.DB, "vi", "/vi/insights/draft-slug/")).toBeNull();
  });

  it("publishes locales and settings independently", async () => {
    const insightId = await createItem(env.DB, admin, "insight", "article");
    await saveDraft(env.DB, admin, insightId, "vi", 1, makeInsight().data);
    await saveDraft(env.DB, admin, insightId, "en", 1, makeInsight().data);
    await publishLocale(env.DB, admin, insightId, "vi", 2, 1);
    expect(await listPublished(env.DB, "en")).toEqual([]);
    await publishLocale(env.DB, admin, insightId, "en", 2, 1);

    const settingsId = await createItem(env.DB, admin, "settings", "settings");
    await saveDraft(env.DB, admin, settingsId, "vi", 1, makeSettings().data);
    await publishLocale(env.DB, admin, settingsId, "vi", 2, 1);
    const vi = await listPublished(env.DB, "vi");
    const en = await listPublished(env.DB, "en");
    expect(vi.map(({ snapshot }) => snapshot.type).sort()).toEqual(["insight", "settings"]);
    expect(en.map(({ snapshot }) => snapshot.type)).toEqual(["insight"]);
  });

  it("resolves flattened redirects after slug publication", async () => {
    const itemId = await createItem(env.DB, admin, "insight", "a");
    await saveDraft(env.DB, admin, itemId, "vi", 1, makeInsight().data);
    await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    await saveItemMetadata(env.DB, admin, itemId, 1, "b", { primaryMediaId: null });
    await publishLocale(env.DB, admin, itemId, "vi", 3, 2);
    await saveItemMetadata(env.DB, admin, itemId, 2, "c", { primaryMediaId: null });
    await publishLocale(env.DB, admin, itemId, "vi", 4, 3);

    expect(await resolveRedirect(env.DB, "vi", "/vi/insights/a/")).toBe(
      "/vi/insights/c/",
    );
    expect(await resolveRedirect(env.DB, "vi", "/vi/insights/b/")).toBe(
      "/vi/insights/c/",
    );
  });

  it("keeps published content available when cache purge is pending", async () => {
    const itemId = await createItem(env.DB, admin, "insight", "cache-test");
    await saveDraft(env.DB, admin, itemId, "vi", 1, makeInsight().data);
    const published = await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    const testEnv = Object.assign({}, env, {
      CACHE_PURGE_TOKEN: "token",
      CLOUDFLARE_ZONE_ID: "zone",
      SITE_ORIGIN: "https://site.test",
    }) as AppEnv;
    const purge = createPurger(async () => new Response(null, { status: 403 }));

    expect(await purge(testEnv, published.affectedPaths)).toBe("pending");
    expect(await getPublished(env.DB, "vi", "/vi/insights/cache-test/")).not.toBeNull();
  });
});
