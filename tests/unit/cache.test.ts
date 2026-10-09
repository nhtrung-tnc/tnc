import { describe, expect, it, vi } from "vitest";
import {
  canonicalCacheUrl,
  createPurger,
  isPublicCacheable,
  loadPublicWithCache,
  privateCacheHeaders,
  publicCacheHeaders,
} from "../../src/server/site/cache";

describe("public cache policy", () => {
  it("uses the required CDN cache policy", () => {
    const headers = publicCacheHeaders();
    expect(headers.get("CDN-Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    expect(headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(privateCacheHeaders().get("Cache-Control")).toBe("private, no-store");
  });

  it("canonicalizes cache keys to the trusted origin and pathname", () => {
    expect(
      canonicalCacheUrl("https://tnchandicraft.com", "/vi/?campaign=test#hero"),
    ).toBe("https://tnchandicraft.com/vi/");
    expect(() =>
      canonicalCacheUrl("https://tnchandicraft.com", "https://evil.example.com/x"),
    ).toThrow();
  });

  it("caches only public successful GET responses without cookies", () => {
    const response = new Response("ok", { status: 200, headers: publicCacheHeaders() });
    expect(isPublicCacheable(new Request("https://site.test/vi/"), response)).toBe(true);
    expect(
      isPublicCacheable(
        new Request("https://site.test/vi/", { headers: { Cookie: "session=x" } }),
        response,
      ),
    ).toBe(false);
    expect(
      isPublicCacheable(new Request("https://site.test/vi/", { method: "POST" }), response),
    ).toBe(false);
    expect(
      isPublicCacheable(
        new Request("https://site.test/vi/"),
        new Response("private", { status: 403 }),
      ),
    ).toBe(false);
  });

  it("returns pending on Cloudflare 403 or timeout and never throws", async () => {
    const forbidden = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const timeout = vi.fn(async () => {
      throw new DOMException("Timed out", "AbortError");
    });
    const testEnv = {
      SITE_ORIGIN: "https://tnchandicraft.com",
      CLOUDFLARE_ZONE_ID: "zone",
      CACHE_PURGE_TOKEN: "token",
    } as AppEnv;

    expect(await createPurger(forbidden)(testEnv, ["/vi/"])).toBe("pending");
    expect(await createPurger(timeout)(testEnv, ["/vi/"])).toBe("pending");
    expect(forbidden).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/zones/zone/purge_cache",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("serves bounded stale content on load failure without refreshing its age", async () => {
    const now = Date.now();
    const cached = new Response("cached", {
      status: 200,
      headers: {
        "X-TNC-Cached-At": String(now - 100_000),
        "Cache-Control": "public, max-age=360",
      },
    });
    const cache = {
      match: vi.fn(async () => cached.clone()),
      put: vi.fn(async () => undefined),
    } as unknown as Pick<Cache, "match" | "put">;
    const load = vi.fn(async () => {
      throw new Error("D1 unavailable");
    });

    const response = await loadPublicWithCache(
      new Request("https://site.test/vi/?campaign=x"),
      { SITE_ORIGIN: "https://site.test" },
      load,
      cache,
      now,
    );
    expect(await response.text()).toBe("cached");
    expect(cache.put).not.toHaveBeenCalled();
    expect(response.headers.has("X-TNC-Cached-At")).toBe(false);
  });

  it("does not serve a cache entry beyond the stale window", async () => {
    const now = Date.now();
    const cache = {
      match: vi.fn(async () =>
        new Response("expired", {
          headers: { "X-TNC-Cached-At": String(now - 361_000) },
        }),
      ),
      put: vi.fn(async () => undefined),
    } as unknown as Pick<Cache, "match" | "put">;

    await expect(
      loadPublicWithCache(
        new Request("https://site.test/vi/"),
        { SITE_ORIGIN: "https://site.test" },
        async () => {
          throw new Error("D1 unavailable");
        },
        cache,
        now,
      ),
    ).rejects.toThrow("D1 unavailable");
  });
});
