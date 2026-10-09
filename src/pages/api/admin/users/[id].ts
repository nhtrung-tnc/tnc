import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { updateUser } from "../../../../server/auth/management";
import { errorResponse } from "../../../../server/http/errors";
import { actorFrom, readJson } from "../../../../server/http/json";

const updateSchema = z
  .object({
    role: z.enum(["admin", "editor"]),
    active: z.boolean(),
  })
  .strict();

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const body = await readJson(request, updateSchema);
    await updateUser(
      env.DB,
      actorFrom(locals),
      params.id ?? "",
      body.role,
      body.active,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
};
