/** Betreiberzugänge gehören nur zum Reset und zur Migration, nicht in den gestarteten App-Prozess. */
export function serverEnvironment(environment: NodeJS.ProcessEnv) {
  const { MIGRATION_DATABASE_URL, E2E_DATABASE_URL, E2E_APP_DATABASE_URL, ...runtime } = environment;
  return runtime;
}
