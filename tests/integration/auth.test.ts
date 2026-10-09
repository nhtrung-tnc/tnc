import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthenticator } from "../../src/server/auth/access";
import { requireRole } from "../../src/server/auth/policy";
import { requireSameOrigin } from "../../src/server/http/csrf";
import { resetDatabase } from "../helpers/database";
import { createAccessTestIssuer } from "../helpers/access-jwt";
import { makeActor } from "../helpers/fixtures";

const worker = (exports as unknown as { default: Fetcher }).default;

describe("Cloudflare Access authentication", () => {
  let issuer: Awaited<ReturnType<typeof createAccessTestIssuer>>;

  beforeAll(async () => {
    issuer = await createAccessTestIssuer(env.ACCESS_ISSUER, env.ACCESS_AUDIENCE);
  });

  beforeEach(resetDatabase);

  async function invite(options: { active?: boolean; subject?: string | null } = {}) {
    await env.DB.prepare(
      "INSERT INTO users (id, access_subject, email_normalized, display_name, role, active) VALUES ('admin', ?, 'admin@example.com', 'Admin', 'admin', ?)",
    )
      .bind(options.subject ?? null, options.active === false ? 0 : 1)
      .run();
  }

  function request(token?: string): Request {
    const headers = token ? { "Cf-Access-Jwt-Assertion": token } : undefined;
    return new Request("https://site.test/admin", { headers });
  }

  it("rejects a missing or invalid signature", async () => {
    const authenticate = createAuthenticator(issuer.getKey);
    await expect(authenticate(request(), env)).rejects.toMatchObject({ status: 401 });

    const otherIssuer = await createAccessTestIssuer(env.ACCESS_ISSUER, env.ACCESS_AUDIENCE);
    await expect(
      authenticate(request(await otherIssuer.sign()), env),
    ).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ["issuer", { issuer: "https://wrong.example.com" }],
    ["audience", { audience: "wrong-audience" }],
    ["expiry", { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
  ])("rejects an invalid %s", async (_label, overrides) => {
    const authenticate = createAuthenticator(issuer.getKey);
    await expect(
      authenticate(request(await issuer.sign(overrides)), env),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects users who are not invited or are disabled", async () => {
    const authenticate = createAuthenticator(issuer.getKey);
    const token = await issuer.sign();
    await expect(authenticate(request(token), env)).rejects.toMatchObject({ status: 403 });

    await invite({ active: false });
    await expect(authenticate(request(token), env)).rejects.toMatchObject({ status: 403 });
  });

  it("links an invited email once and never remaps a different subject", async () => {
    await invite();
    const authenticate = createAuthenticator(issuer.getKey);
    const actor = await authenticate(request(await issuer.sign()), env);
    expect(actor).toMatchObject({ id: "admin", subject: "access-subject", role: "admin" });

    await expect(
      authenticate(
        request(await issuer.sign({ subject: "different-subject" })),
        env,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("authorization and request protection", () => {
  it("prevents an editor from using admin privileges", () => {
    expect(() => requireRole(makeActor("editor"), "admin")).toThrow();
    expect(() => requireRole(makeActor("admin"), "editor")).not.toThrow();
  });

  it("rejects unsafe cross-origin and missing-origin requests", () => {
    expect(() =>
      requireSameOrigin(
        new Request("https://site.test/api/admin", {
          method: "POST",
          headers: { Origin: "https://evil.example.com" },
        }),
        "https://site.test",
      ),
    ).toThrow();
    expect(() =>
      requireSameOrigin(
        new Request("https://site.test/api/admin", { method: "DELETE" }),
        "https://site.test",
      ),
    ).toThrow();
  });

  it.each(["/admin", "/admin/", "/admin/content", "/admin/config.yml", "/api/admin", "/api/admin/items", "/preview", "/preview/item/vi"])(
    "protects %s before route handling",
    async (path) => {
      const response = await worker.fetch(`https://site.test${path}`);
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    },
  );

  it("checks origin before Access on unsafe requests", async () => {
    const crossOrigin = await worker.fetch("https://site.test/api/admin/items", {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(crossOrigin.status).toBe(403);

    const invalidJwt = "secret.invalid.jwt";
    const invalidAuth = await worker.fetch("https://site.test/api/admin/items", {
      method: "POST",
      headers: {
        Origin: "https://site.test",
        "Cf-Access-Jwt-Assertion": invalidJwt,
      },
    });
    expect(invalidAuth.status).toBe(401);
    const body = await invalidAuth.text();
    expect(body).not.toContain(invalidJwt);
    expect(body).not.toContain("stack");
    expect(await worker.fetch("https://site.test/", { redirect: "manual" })).toMatchObject({
      status: 302,
    });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "authenticates unsafe %s requests after origin validation",
    async (method) => {
      const response = await worker.fetch("https://site.test/api/admin/items", {
        method,
        headers: { Origin: "https://site.test" },
      });
      expect(response.status).toBe(401);
    },
  );
});
