import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { serveMedia } from "../../server/media/serve";

export const GET: APIRoute = ({ request, params }) =>
  serveMedia(request, env, params.id ?? "");
