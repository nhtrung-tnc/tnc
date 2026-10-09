import type { Actor, Role } from "../content/types";
import { AppError } from "../http/errors";

export function requireRole(actor: Actor, role: Role): void {
  if (role === "admin" && actor.role !== "admin") {
    throw new AppError("FORBIDDEN", 403, "Administrator access is required");
  }
}
