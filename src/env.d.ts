/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface AppEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  ACCESS_ISSUER: string;
  ACCESS_AUDIENCE: string;
  SITE_ORIGIN: string;
  CLOUDFLARE_ZONE_ID: string;
  CACHE_PURGE_TOKEN: string;
  TEST_MIGRATIONS?: Array<{ name: string; queries: string[] }>;
}

declare namespace Cloudflare {
  interface Env extends AppEnv {}
}

declare namespace App {
  interface Locals {
    actor?: import("./server/content/types").Actor;
    requestId?: string;
    cfContext: ExecutionContext;
  }
}
