import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { inviteUser, listUsers } from "../../../../server/auth/management";
import { errorResponse } from "../../../../server/http/errors";
import { actorFrom, readJson } from "../../../../server/http/json";

const inviteSchema = z
  .object({
    email: z.email().max(254),
    role: z.enum(["admin", "editor"]),
  })
  .strict();

export const GET: APIRoute = async ({ locals }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    return Response.json({ users: await listUsers(env.DB, actorFrom(locals)) });
  } catch (error) {
    return errorResponse(error, requestId);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const body = await readJson(request, inviteSchema);
    const id = await inviteUser(
      env.DB,
      actorFrom(locals),
      body.email,
      body.role,
    );
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
};
