import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const worker = (exports as unknown as { default: Fetcher }).default;

describe("Astro Workers runtime", () => {
  it("redirects the root to Vietnamese", async () => {
    const response = await worker.fetch("https://site.test/", {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/vi/");
  });

  it("provides local D1 and R2 bindings", () => {
    expect(env.DB).toBeDefined();
    expect(env.MEDIA).toBeDefined();
  });

  it("does not expose legacy Decap assets", async () => {
    const response = await worker.fetch("https://site.test/admin/config.yml");
    expect(response.status).toBe(404);
  });
});
