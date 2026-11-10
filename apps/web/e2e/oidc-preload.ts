/** Kalte Vite-/Nitro-Kompilierung auf langsamen Dateisystemen darf keine Browseranfrage abbrechen. Nur E2E. */
const runtime = globalThis as unknown as { Bun: { serve: (options: Record<string, unknown>) => unknown } };
const serve = runtime.Bun.serve.bind(runtime.Bun);
runtime.Bun.serve = (options) => serve({ ...options, idleTimeout: 60 });
