import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/server/site/markdown";
import { serializeJsonLd } from "../../src/server/site/seo";

describe("safe content rendering", () => {
  it("drops raw scripts, event handlers and unsafe links", async () => {
    const html = await renderMarkdown(
      `<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))`,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("preserves safe internal media images", async () => {
    const html = await renderMarkdown("![Woven basket](/media/media-123)");
    expect(html).toContain('src="/media/media-123"');
    expect(html).toContain('alt="Woven basket"');
  });

  it("escapes script-closing text in JSON-LD", () => {
    const json = serializeJsonLd({ headline: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json).headline).toBe("</script><script>alert(1)</script>");
  });
});
