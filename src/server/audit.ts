import type { Actor } from "./content/types";

export async function writeAudit(
  db: D1Database,
  actor: Actor,
  action: string,
  resourceId: string,
  requestId: string,
): Promise<void> {
  await auditStatement(db, actor, action, resourceId, requestId).run();
}

export function auditStatement(
  db: D1Database,
  actor: Actor,
  action: string,
  resourceId: string,
  requestId: string = crypto.randomUUID(),
): D1PreparedStatement {
  const resourceType = action.split(".", 1)[0] || "cms";
  return db
    .prepare(
      `INSERT INTO audit_events
       (id, actor_user_id, action, resource_type, resource_id, metadata_json, request_id)
       VALUES (?, ?, ?, ?, ?, '{}', ?)`,
    )
    .bind(crypto.randomUUID(), actor.id, action, resourceType, resourceId, requestId);
}
