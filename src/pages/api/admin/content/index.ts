import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";
import { createItem, listDrafts } from "../../../../server/content/repository";
import { errorResponse } from "../../../../server/http/errors";
import { actorFrom, readJson } from "../../../../server/http/json";

const createSchema = z.object({
  type: z.enum(["homepage", "insight", "settings"]),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
}).strict();

export const GET: APIRoute = async ({ locals }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    actorFrom(locals);
    return Response.json({ items: await listDrafts(env.DB) });
  } catch (error) { return errorResponse(error, requestId); }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const requestId = locals.requestId ?? crypto.randomUUID();
  try {
    const actor = actorFrom(locals);
    const body = await readJson(request, createSchema);
    const id = await createItem(env.DB, actor, body.type, body.slug);
    return Response.json({ id }, { status: 201 });
  } catch (error) { return errorResponse(error, requestId); }
};
