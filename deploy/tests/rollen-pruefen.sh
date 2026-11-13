#!/bin/sh
# Prüft die echte Laufzeit-Anmeldung eines gestarteten App-Containers, nicht eine vom Test abgesicherte Verbindung.
# PostgreSQL 18: sql-altertable.html, sql-set-role.html und runtime-config-client.html#GUC-SESSION-REPLICATION-ROLE.
set -eu
container=${1:?Aufruf: rollen-pruefen.sh <App-Container>}
docker exec --user bun -i -w /app/apps/web "$container" bun -e "$(cat <<'JAVASCRIPT'
const { default: postgres } = await import("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
const failures = [];
try {
  const [role] = await sql`select current_user as current, session_user as session`;
  if (role.current !== "haben_app" || role.session !== "haben_app") failures.push(`Laufzeit-Anmeldung: ${role.current}/${role.session} statt haben_app`);
  const environment = (await Bun.file("/proc/1/environ").text()).split("\0");
  const serverEnvironment = Object.fromEntries(environment.filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  // /proc zeigt Bun-Nachladungen aus .env nicht zuverlässig. Ein echter Child-Bun liest mit derselben Übergabe und CWD erneut.
  const child = Bun.spawnSync([process.execPath, "-e", "console.log(Boolean(process.env.MIGRATION_DATABASE_URL))"], {
    env: serverEnvironment, cwd: process.cwd(), stdout: "pipe", stderr: "pipe",
  });
  if (child.exitCode !== 0 || child.stdout.toString().trim() !== "false") failures.push("Bun erhält oder lädt die private Migrationsadresse");
  for (const [name, command] of [
    ["Trigger abschalten", "alter table journal_lines disable trigger journal_lines_locked"],
    ["Replikationsmodus", "set local session_replication_role = replica"],
    ["Tabelle ändern", "alter table journal_lines add column rollen_test text"],
    ["Tabelle löschen", "drop table journal_lines cascade"],
    ["Funktion ändern", "alter function haben_lock_audit_chain() rename to rollen_test"],
    ["Funktion löschen", "drop function haben_lock_audit_chain()"],
    ["Eigentümerrolle wählen", "set local role haben"],
    ["Schattenrelation anlegen", "create temporary table audit_log (actor text)"],
    ["Objekt in public anlegen", "create table public.rollen_test (id integer)"],
  ]) {
    const allowed = new Error("erlaubt");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(command);
        // Auch ein unerwartet erlaubter Eingriff wird vollständig zurückgerollt.
        throw allowed;
      });
    } catch (error) {
      if (error === allowed) failures.push(`${name}: erlaubt statt 42501`);
      else if (error.code !== "42501") failures.push(`${name}: ${error.code ?? "Fehler"} statt 42501`);
      else console.log(`${name}: 42501`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  // Normaler Schreibweg einschließlich Audit-Kette, Sequenzen und Siegel; Testdaten bleiben nicht bestehen.
  const rollback = new Error("Testdaten zurückrollen");
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor', 'test:rollen', true)`;
      const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values ('2026-01-10', 'Rollentest', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit)
        values (${entry.id}, '1200', 100, 0), (${entry.id}, '8400', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${entry.id}`;
      await tx`set constraints all immediate`;
      const [seal] = await tx`select row_id from seals where table_name = 'journal_entries' and row_id = ${entry.id}`;
      if (!seal) throw new Error("Siegel fehlt");
      const problems = await tx`select * from haben_integrity_problems(1)`;
      if (problems.length) throw new Error("Kette oder Siegel beschädigt");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  console.log("App-Anmeldung, Schreibweg, Audit-Kette und Siegel stimmen");
} finally { await sql.end(); }
JAVASCRIPT
)"
