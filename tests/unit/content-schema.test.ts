import { describe, expect, it } from "vitest";
import {
  collectMediaIds,
  localeSchema,
  validateSnapshot,
} from "../../src/server/content/schema";
import { makeHomepage, makeInsight } from "../helpers/fixtures";

describe("content schema", () => {
  it("accepts the supported locales only", () => {
    expect(localeSchema.parse("vi")).toBe("vi");
    expect(() => localeSchema.parse("fr")).toThrow();
  });

  it("rejects an invalid slug", () => {
    expect(() =>
      validateSnapshot("insight", { ...makeInsight(), slug: "../admin" }),
    ).toThrow();
  });

  it("rejects an empty title", () => {
    const snapshot = makeInsight();
    snapshot.data.title = "";
    expect(() => validateSnapshot("insight", snapshot)).toThrow();
  });

  it("enforces text and slug limits", () => {
    expect(() =>
      validateSnapshot("insight", { ...makeInsight(), slug: "a".repeat(121) }),
    ).toThrow();
    expect(() =>
      validateSnapshot("insight", {
        ...makeInsight(),
        data: { ...makeInsight().data, title: "a".repeat(201) },
      }),
    ).toThrow();
    expect(() =>
      validateSnapshot("insight", {
        ...makeInsight(),
        data: { ...makeInsight().data, description: "a".repeat(501) },
      }),
    ).toThrow();
    expect(() =>
      validateSnapshot("insight", {
        ...makeInsight(),
        data: { ...makeInsight().data, bodyMarkdown: "a".repeat(200_001) },
      }),
    ).toThrow();
  });

  it("rejects unknown fields and unsafe URLs", () => {
    expect(() =>
      validateSnapshot("insight", { ...makeInsight(), unexpected: true }),
    ).toThrow();
    const homepage = makeHomepage();
    homepage.data.nav.links[0]!.target = "javascript:alert(1)";
    expect(() => validateSnapshot("homepage", homepage)).toThrow();
  });

  it("caps repeatable homepage fields at 100 entries", () => {
    const homepage = makeHomepage();
    homepage.data.nav.links = Array.from({ length: 101 }, (_, index) => ({
      label: `Link ${index}`,
      target: `#section-${index}`,
    }));
    expect(() => validateSnapshot("homepage", homepage)).toThrow();
  });

  it("collects unique media references from structured fields and Markdown", () => {
    const insight = makeInsight();
    insight.shared.primaryMediaId = "media-primary";
    insight.data.seo.image = { mediaId: "media-seo", alt: "SEO image" };
    insight.data.bodyMarkdown =
      "![One](/media/media-body) ![Duplicate](/media/media-primary)";

    expect(collectMediaIds(validateSnapshot("insight", insight))).toEqual([
      "media-body",
      "media-primary",
      "media-seo",
    ]);
  });
});
