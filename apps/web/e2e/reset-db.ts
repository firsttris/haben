import postgres from "postgres";

/** Leert die E2E-Datenbank vor dem Lauf. Aus Sicherheitsgründen nur, wenn ihr Name auf „e2e“ endet. */
async function resetDb() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt, z. B. postgres://haben@localhost:5432/haben_e2e");
  const name = new URL(url).pathname.slice(1);
  if (!/e2e$/i.test(name)) throw new Error(`Die E2E-Datenbank muss auf „e2e“ enden, nicht „${name}“: sie wird geleert.`);
  // Die Datenbank des GmbH-Szenarios (playwright.config.ts) gibt es anfangs nicht; angelegt wird sie über die Datenbank postgres
  const admin = postgres(Object.assign(new URL(url), { pathname: "/postgres" }).toString(), { max: 1, onnotice: () => {} });
  try {
    if (process.env.E2E_APP_DATABASE_URL) await createTestLogin(admin, new URL(process.env.DATABASE_URL!), new URL(url));
    const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists) await admin.unsafe(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`drop schema if exists public cascade`;
    await sql`drop schema if exists drizzle cascade`;
    await sql`create schema public`;
  } finally {
    await sql.end();
  }
}

/** Nur eine erfundene Testanmeldung anlegen; Rechte und Härtung muss die echte Produktmigration übernehmen. */
async function createTestLogin(admin: postgres.Sql, application: URL, migration: URL) {
  const role = decodeURIComponent(application.username);
  if (!/^haben_e2e_app(?:_[a-z0-9_]+)?$/.test(role) || role.length > 63)
    throw new Error("Die E2E-App-Rolle muss haben_e2e_app oder haben_e2e_app_<kennung> heißen.");
  if (application.hostname !== migration.hostname || (application.port || "5432") !== (migration.port || "5432") || application.pathname !== migration.pathname)
    throw new Error("E2E_DATABASE_URL und E2E_APP_DATABASE_URL müssen dieselbe Testdatenbank verwenden.");
  if (application.username === migration.username) throw new Error("Die E2E-App-Anmeldung muss sich von der Betreiberanmeldung unterscheiden.");
  await admin.begin(async (transaction) => {
    // Rollen sind clusterweit; die parallelen Durchläufe legen dieselbe Anmeldung nur einmal an.
    // https://www.postgresql.org/docs/18/sql-createrole.html
    await transaction`select pg_advisory_xact_lock(${0x653265})`;
    const [exists] = await transaction`select 1 from pg_roles where rolname = ${role}`;
    if (!exists) {
      const [query] =
        await transaction`select format('create role %I login password %L', ${role}::text, ${decodeURIComponent(application.password)}::text) as statement`;
      await transaction.unsafe(query.statement);
    }
  });
}

await resetDb();
