import astro from "@astrojs/cloudflare/entrypoints/server";
import { cleanupMedia } from "./server/media/cleanup";

export default {
  fetch: astro.fetch,
  scheduled(controller: ScheduledController, env: AppEnv, context: ExecutionContext) {
    context.waitUntil(cleanupMedia(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<AppEnv>;
