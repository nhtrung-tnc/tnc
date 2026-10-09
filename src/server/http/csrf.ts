import { AppError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOrigin(request: Request, trustedOrigin: string): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const origin = request.headers.get("Origin");
  let expected: string;
  try {
    expected = new URL(trustedOrigin).origin;
  } catch {
    throw new AppError("SERVER_MISCONFIGURED", 500, "Trusted origin is invalid");
  }
  if (!origin || origin !== expected) {
    throw new AppError("INVALID_ORIGIN", 403, "Request origin is not allowed");
  }
}
