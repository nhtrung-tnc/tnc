import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { Actor } from "../content/types";
import { AppError } from "../http/errors";
import { findOrLinkUser } from "./users";

type Authenticator = (request: Request, env: AppEnv) => Promise<Actor>;

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function remoteKeyFor(issuer: string): JWTVerifyGetKey {
  const cached = remoteKeys.get(issuer);
  if (cached) return cached;
  const key = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer), {
    timeoutDuration: 5_000,
    cacheMaxAge: 300_000,
  });
  remoteKeys.set(issuer, key);
  return key;
}

function bearerFrom(request: Request): string | null {
  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (assertion !== null) return assertion;
  return request.headers.get("Cookie")?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1] ?? null;
}

export function createAuthenticator(getKey?: JWTVerifyGetKey): Authenticator {
  return async (request, env) => {
    const token = bearerFrom(request);
    if (!token) {
      throw new AppError("AUTH_REQUIRED", 401, "Cloudflare Access authentication is required");
    }

    try {
      const { payload } = await jwtVerify(
        token,
        getKey ?? remoteKeyFor(env.ACCESS_ISSUER),
        {
          issuer: env.ACCESS_ISSUER,
          audience: env.ACCESS_AUDIENCE,
          algorithms: ["RS256"],
        },
      );
      if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
        throw new Error("Required Access claims are missing");
      }
      return await findOrLinkUser(env.DB, payload.sub, payload.email);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("INVALID_ACCESS_TOKEN", 401, "Cloudflare Access token is invalid");
    }
  };
}

export const authenticate: Authenticator = createAuthenticator();
