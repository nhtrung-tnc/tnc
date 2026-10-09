import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase } from "../helpers/database";

const worker = (exports as unknown as { default: Fetcher }).default;

describe("whole-worker security regression", () => {
  beforeEach(resetDatabase);

  it("sets browser security headers on public and private responses", async () => {
    for (const path of ["/vi/", "/admin/"]) {
      const response = await worker.fetch(`https://site.test${path}`);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    }
  });

  it("does not trust spoofed identity headers without a signed Access JWT", async () => {
    const response = await worker.fetch("https://site.test/admin/", {
      headers: {
        "Cf-Access-Authenticated-User-Email":"admin@example.com",
        "Cf-Access-User":"admin@example.com",
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not log URL query credentials when rejecting a private request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const secret = "must-not-enter-logs";
    const response = await worker.fetch(`https://site.test/admin/?token=${secret}`);
    expect(response.status).toBe(401);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    warn.mockRestore();
  });

  it("never marks private error responses as publicly cacheable", async () => {
    const first = await worker.fetch("https://site.test/api/admin/content");
    const second = await worker.fetch("https://site.test/api/admin/content", {
      headers: { "Cf-Access-Authenticated-User-Email":"other@example.com" },
    });
    for (const response of [first, second]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Vary")).toContain("Cookie");
    }
  });
});
