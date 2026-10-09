interface NodeProcessLike {
  argv:string[];
  env:Record<string, string | undefined>;
  exitCode?:number;
}

export function processLike():NodeProcessLike | null {
  return (globalThis as typeof globalThis & { process?:NodeProcessLike }).process ?? null;
}

export function directInvocation(filename:string):boolean {
  return processLike()?.argv[1]?.replaceAll("\\", "/").endsWith(`/scripts/${filename}`) ?? false;
}

export function explicitTarget():"local" | "production" {
  const process = processLike();
  const index = process?.argv.indexOf("--target") ?? -1;
  const value = index >= 0 ? process?.argv[index + 1] : undefined;
  if (value !== "local" && value !== "production") {
    throw new Error("An explicit --target local|production argument is required");
  }
  return value;
}

export async function loadRuntimeConfig<T>():Promise<T> {
  const specifier = processLike()?.env.OPERATION_CONFIG_MODULE;
  if (!specifier?.startsWith("file://")) {
    throw new Error("OPERATION_CONFIG_MODULE must be an explicit file:// module URL");
  }
  const module = await import(specifier) as { default?:T };
  if (!module.default) throw new Error("Operation config module must have a default export");
  return module.default;
}

export function failSafely(error:unknown):void {
  const message = error instanceof Error ? error.message : "Operation failed";
  console.error(message);
  const process = processLike();
  if (process) process.exitCode = 1;
}
