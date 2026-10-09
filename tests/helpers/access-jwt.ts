import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

interface TokenOverrides {
  subject?: string;
  email?: string;
  issuer?: string;
  audience?: string;
  expiresAt?: number;
}

export async function createAccessTestIssuer(
  issuer = "https://test.cloudflareaccess.com",
  audience = "test-audience",
): Promise<{
  jwks: JSONWebKeySet;
  getKey: JWTVerifyGetKey;
  sign: (overrides?: TokenOverrides) => Promise<string>;
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  const jwks: JSONWebKeySet = { keys: [publicJwk] };

  return {
    jwks,
    getKey: createLocalJWKSet(jwks),
    sign: async (overrides = {}) =>
      new SignJWT({ email: overrides.email ?? "admin@example.com" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setSubject(overrides.subject ?? "access-subject")
        .setIssuer(overrides.issuer ?? issuer)
        .setAudience(overrides.audience ?? audience)
        .setIssuedAt()
        .setExpirationTime(overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 300)
        .sign(privateKey),
  };
}
