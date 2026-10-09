/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface AppEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES: ImagesBinding;
  TEST_MIGRATIONS?: Array<{ name: string; queries: string[] }>;
}

declare namespace Cloudflare {
  interface Env extends AppEnv {}
}

declare namespace App {
  interface Locals {
    runtime: {
      env: AppEnv;
      ctx: ExecutionContext;
    };
  }
}
