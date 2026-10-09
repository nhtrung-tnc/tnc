import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveDraft } from "../../src/server/content/drafts";
import { publishLocale, saveItemMetadata } from "../../src/server/content/publish";
import { createItem } from "../../src/server/content/repository";
import { resetDatabase, seedActor } from "../helpers/database";
import { makeActor, makeHomepage, makeInsight } from "../helpers/fixtures";

const worker = (exports as unknown as { default: Fetcher }).default;
const admin = makeActor("admin");

describe("multilingual public site", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedActor(admin);
  });

  it.each([
    ["vi", "Nội dung đang được cập nhật"],
    ["en", "Content is being updated"],
    ["ja", "コンテンツを更新中です"],
  ])("renders the %s fallback homepage", async (locale, message) => {
    const response = await worker.fetch(`https://site.test/${locale}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(message);
  });

  it("returns 404 for an unsupported locale and an unpublished article", async () => {
    expect((await worker.fetch("https://site.test/fr/")).status).toBe(404);
    const itemId = await createItem(env.DB, admin, "insight", "private-draft");
    await saveDraft(env.DB, admin, itemId, "vi", 1, makeInsight().data);
    expect(
      (await worker.fetch("https://site.test/vi/insights/private-draft/")).status,
    ).toBe(404);
  });

  it("renders a published article with sanitized Markdown", async () => {
    const itemId = await createItem(env.DB, admin, "insight", "safe-article");
    const data = makeInsight().data;
    data.bodyMarkdown = "## Safe heading\n\n<script>alert(1)</script>\n\nUseful text.";
    await saveDraft(env.DB, admin, itemId, "vi", 1, data);
    await publishLocale(env.DB, admin, itemId, "vi", 2, 1);

    const response = await worker.fetch("https://site.test/vi/insights/safe-article/");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Safe heading");
    expect(html).toContain("Useful text");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("lists only published content in the sitemap and hreflang links", async () => {
    const homeId = await createItem(env.DB, admin, "homepage", "home");
    await saveDraft(env.DB, admin, homeId, "vi", 1, makeHomepage().data);
    await saveDraft(env.DB, admin, homeId, "en", 1, makeHomepage().data);
    await publishLocale(env.DB, admin, homeId, "vi", 2, 1);

    const articleId = await createItem(env.DB, admin, "insight", "visible");
    await saveDraft(env.DB, admin, articleId, "vi", 1, makeInsight().data);
    await publishLocale(env.DB, admin, articleId, "vi", 2, 1);
    await createItem(env.DB, admin, "insight", "draft-only");

    const homepage = await worker.fetch("https://site.test/vi/");
    const homeHtml = await homepage.text();
    expect(homeHtml).toContain('hreflang="vi"');
    expect(homeHtml).not.toContain('hreflang="en"');

    const sitemap = await (await worker.fetch("https://site.test/sitemap.xml")).text();
    expect(sitemap).toContain("https://site.test/vi/");
    expect(sitemap).toContain("https://site.test/vi/insights/visible/");
    expect(sitemap).not.toContain("draft-only");
    expect(sitemap).not.toContain("https://site.test/en/");
  });

  it("serves published redirects as permanent redirects", async () => {
    const itemId = await createItem(env.DB, admin, "insight", "old-slug");
    await saveDraft(env.DB, admin, itemId, "vi", 1, makeInsight().data);
    await publishLocale(env.DB, admin, itemId, "vi", 2, 1);
    await saveItemMetadata(env.DB, admin, itemId, 1, "new-slug", {
      primaryMediaId: null,
    });
    await publishLocale(env.DB, admin, itemId, "vi", 3, 2);

    const response = await worker.fetch("https://site.test/vi/insights/old-slug/", {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/vi/insights/new-slug/");
  });
});
