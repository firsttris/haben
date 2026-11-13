/** Betreiberzugänge gehören nur zum Reset und zur Migration, nicht in den gestarteten App-Prozess. */
export function serverEnvironment(environment: NodeJS.ProcessEnv) {
  // Entfernte Schlüssel lädt Bun aus .env erneut; leere Werte behalten Vorrang vor der Datei.
  // https://bun.com/docs/runtime/environment-variables
  return { ...environment, MIGRATION_DATABASE_URL: "", E2E_DATABASE_URL: "", E2E_APP_DATABASE_URL: "" };
}
