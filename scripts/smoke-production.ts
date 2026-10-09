interface SmokeResult { name:string; status:number; ok:boolean }

function originFromArgs():URL {
  const index = process.argv.indexOf("--origin");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("--origin <worker-test-host> is required");
  const origin = new URL(value);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Smoke origin must be a bare HTTPS origin");
  }
  return origin;
}

async function check(origin:URL, name:string, path:string, expected:number[]):Promise<SmokeResult> {
  const response = await fetch(new URL(path, origin), { redirect:"manual" });
  const ok = expected.includes(response.status);
  if (!ok) throw new Error(`${name} returned unexpected status ${response.status}`);
  return { name, status:response.status, ok };
}

export async function smokeProduction(origin:URL):Promise<SmokeResult[]> {
  const results:SmokeResult[] = [];
  const root = await fetch(new URL("/", origin), { redirect:"manual" });
  if (root.status !== 302 || root.headers.get("Location") !== "/vi/") {
    throw new Error("Root locale redirect is invalid");
  }
  results.push({ name:"root redirect", status:root.status, ok:true });
  for (const locale of ["vi", "en", "ja"]) {
    const response = await fetch(new URL(`/${locale}/`, origin));
    if (response.status !== 200) throw new Error(`${locale} homepage returned ${response.status}`);
    if (response.headers.get("X-Content-Type-Options") !== "nosniff") throw new Error(`${locale} security headers are missing`);
    results.push({ name:`${locale} homepage`, status:response.status, ok:true });
  }
  const sitemap = await fetch(new URL("/sitemap.xml", origin));
  const xml = await sitemap.text();
  if (sitemap.status !== 200 || /\/(?:admin|api\/admin|preview)(?:\/|<)/.test(xml)) {
    throw new Error("Sitemap is unavailable or exposes a private route");
  }
  results.push({ name:"sitemap", status:sitemap.status, ok:true });
  results.push(await check(origin, "admin protected", "/admin/", [302, 401, 403]));
  results.push(await check(origin, "admin API protected", "/api/admin/content", [302, 401, 403]));
  results.push(await check(origin, "preview protected", "/preview/not-found/vi", [302, 401, 403]));
  return results;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  Promise.resolve()
    .then(() => smokeProduction(originFromArgs()))
    .then((results) => console.log(JSON.stringify({ passed:results.length, results })))
    .catch((error:unknown) => {
      console.error(error instanceof Error ? error.message : "Production smoke failed");
      process.exitCode = 1;
    });
}
