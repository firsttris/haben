import postgres from "postgres";

/** Leert die E2E-Datenbank vor dem Lauf. Aus Sicherheitsgründen nur, wenn ihr Name auf „e2e“ endet. */
async function resetDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt, z. B. postgres://haben@localhost:5432/haben_e2e");
  const name = new URL(url).pathname.slice(1);
  if (!/e2e$/i.test(name)) throw new Error(`Die E2E-Datenbank muss auf „e2e“ enden, nicht „${name}“: sie wird geleert.`);
  // Die Datenbank des GmbH-Szenarios (playwright.config.ts) gibt es anfangs nicht; angelegt wird sie über die Datenbank postgres
  const admin = postgres(Object.assign(new URL(url), { pathname: "/postgres" }).toString(), { max: 1, onnotice: () => {} });
  try {
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

await resetDb();
