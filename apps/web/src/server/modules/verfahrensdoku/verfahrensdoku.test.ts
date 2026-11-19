import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pkg from "../../../../../../package.json" with { type: "json" };
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const GEHEIMNISSE = {
  tokenHash: "TOKEN-HASH-4711",
  tokenPrefix: "hb_Zz9Q",
  zertifikat: "GEHEIMES-ZERTIFIKAT-4711",
  postfach: "POSTFACH-PASSWORT-4711",
  ablage: "ARCHIV-TOKEN-4711",
  bank: "BANK-SITZUNG-4711",
  backup: "BACKUP-PASSWORT-4711",
};

const DETAILS = {
  verantwortlich: "Max Mustermann, vertreten durch Erika Mustermann",
  datensicherung: "Täglich mit dem Backup-Container, monatlich auf eine externe Platte im Tresor.",
  aufbewahrungsort: "Server im Büro in Regensburg, Sicherung bei einem Anbieter in Deutschland.",
  papierbelege: "Es wird nicht gescannt; Papierbelege liegen im Ordner im Büro.",
  serverbetrieb: "Selbst betrieben, Updates spielt Max Mustermann monatlich ein.",
  schluesselablage: "Im Passwortmanager, Notfallzugang beim Steuerbüro.",
  ergaenzungen: "",
};

describe.skipIf(!testDatabaseUrl)("Verfahrensdokumentation aus der Instanz (Postgres)", () => {
  let sql: postgres.Sql;
  let doku: typeof import("./index.ts");
  const now = new Date("2026-11-16T10:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    doku = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`delete from procedure_details`;
    await sql`delete from backup_status`;
  });

  async function seed() {
    await sql`delete from "user"`;
    await sql`insert into "user" (id, name, email, role, created_at) values
      ('inhaber-1', 'Max Mustermann', 'max@example.com', 'inhaber', '2026-01-05T09:00:00Z'),
      ('stb-1', 'Steuerbüro Beispiel', 'stb@example.com', 'steuerberatung', '2026-02-01T09:00:00Z')`;
    const firma = {
      id: 1,
      name: "Mustermann IT",
      strasse: "Musterstraße 12",
      plz: "93047",
      ort: "Regensburg",
      kontenrahmen: "SKR04",
      versteuerung: "soll",
      mcp_enabled: true,
    };
    await sql`insert into company ${sql(firma)} on conflict (id) do update set ${sql(firma)}`;
    await sql`insert into backup_status (kind, ok, snapshot, message, target, at) values
      ('backup', true, 'a1b2c3d4', '120 Dateien', ${`rest:https://nutzer:${GEHEIMNISSE.backup}@backup.example/haben`}, '2026-11-16T02:00:00Z'),
      ('restore_check', true, 'a1b2c3d4', 'Kette und Siegel geprüft', 'rest:https://backup.example/haben', '2026-11-15T03:00:00Z'),
      ('restore_check', false, null, ${`Fatal: unable to open repository at rest:https://nutzer:${GEHEIMNISSE.backup}@backup.example/haben`}, null, '2026-11-16T03:00:00Z')`;
    await sql`delete from mcp_tokens`;
    await sql`insert into mcp_tokens (name, token_hash, prefix, scopes, expires_at)
      values ('Claude am Laptop', ${GEHEIMNISSE.tokenHash}, ${GEHEIMNISSE.tokenPrefix}, ${["haben:lesen"]}, '2027-06-01T00:00:00Z')`;
    await sql`delete from elster_certificates`;
    await sql`insert into elster_certificates (filename, ciphertext, valid_until, pin_ciphertext)
      values ('zertifikat.pfx', ${Buffer.from(GEHEIMNISSE.zertifikat)}, '2028-03-31', ${Buffer.from(GEHEIMNISSE.zertifikat)})`;
    await sql`delete from inbox_settings`;
    await sql`insert into inbox_settings (host, port, secure, username, ciphertext)
      values ('imap.example.com', 993, true, 'belege@example.com', ${Buffer.from(GEHEIMNISSE.postfach)})`;
    await sql`delete from archive_target`;
    await sql`insert into archive_target (url, file_field, header_name, ciphertext, since)
      values ('https://archiv.example/api/upload?schluessel=geheim', 'datei', 'Authorization', ${Buffer.from(GEHEIMNISSE.ablage)}, '2026-11-02T09:00:00Z')`;
  }

  it("nennt Zugänge mit Rolle, die Datenbankrolle und das Backup-Ziel", async () => {
    await seed();
    const text = doku.buildProcedureDocument(await doku.readInstanzStand(now), { ...DETAILS }, now);
    const md = JSON.stringify(text);
    const zugaenge = text.abschnitte.find((a) => a.titel.includes("Zugänge"))!;
    expect(zugaenge.liste).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Max Mustermann \(max@example\.com\): Inhaber/),
        expect.stringMatching(/^Steuerbüro Beispiel \(stb@example\.com\): Steuerberatung/),
      ]),
    );
    expect(zugaenge.liste).toContainEqual(expect.stringMatching(/^API-Token „Claude am Laptop“: haben:lesen, gültig bis/));
    const [rolle] = await sql<{ login: string }[]>`select session_user as login`;
    expect(text.abschnitte.find((a) => a.titel.startsWith("3."))!.absaetze.join("\n")).toContain(`„${rolle!.login}“`);
    const betrieb = text.abschnitte.find((a) => a.titel.startsWith("6."))!.absaetze.join("\n");
    expect(betrieb).toContain("nach rest:https://backup.example/haben");
    expect(betrieb).toMatch(/Letzter bestandener Test-Restore: .*Kette und Siegel geprüft/);
    expect(betrieb).toContain("schlug fehl: Fatal: unable to open repository at rest:https://backup.example/haben");
    expect(md).toContain("Kontenrahmen: SKR04 (DATEV). Soll-Versteuerung");
    expect(md).toContain("Postfach belege@example.com auf imap.example.com");
    // Nur der Ursprung der Adresse: Pfad und Anfrage können Kennungen tragen
    expect(md).toContain("seit 02.11.2026 zusätzlich als Kopie an das Dokumentenarchiv unter https://archiv.example;");
    expect(md).not.toContain("schluessel=geheim");
    expect(md).toContain("ELSTER-Zertifikat ist hinterlegt, gültig bis 31.03.2028");
  });

  it("nennt den Zähler je Kunde nur an der Art, für die er läuft (#1426)", async () => {
    await seed();
    await sql`update company set invoice_counter_per_customer = true`;
    const text = doku.buildProcedureDocument(await doku.readInstanzStand(now), { ...DETAILS }, now);
    const liste = text.abschnitte.find((a) => a.titel.startsWith("2."))!.liste!;
    expect(liste.find((e) => e.startsWith("Rechnungsnummern"))).toContain(
      "jeder Kunde hat einen eigenen Zähler; Storno und Korrektur zählen im Kreis, den die Einstellung beim Festschreiben ergibt",
    );
    expect(liste.find((e) => e.startsWith("Angebotsnummern"))).not.toContain("eigenen Zähler");
  });

  it("enthält keine Geheimnisse, weder im Datenmodell noch im Markdown", async () => {
    await seed();
    const document = doku.buildProcedureDocument(await doku.readInstanzStand(now), { ...DETAILS }, now);
    const ausgaben = [JSON.stringify(document), await doku.procedureMarkdown(now)];
    for (const ausgabe of ausgaben) for (const geheim of Object.values(GEHEIMNISSE)) expect(ausgabe).not.toContain(geheim);
  });

  it("speichert die Angaben mit Änderungsprotokoll und dem Konto als Akteur", async () => {
    await doku.saveProcedureDetails("inhaber-1", { ...DETAILS, datensicherung: "Erste Fassung" });
    await doku.saveProcedureDetails("inhaber-1", { ...DETAILS });
    expect(await doku.loadProcedureDetails()).toMatchObject(DETAILS);
    const eintraege = await sql<{ actor: string; action: string; old: string | null; neu: string }[]>`
      select actor, action, old_value ->> 'datensicherung' as old, new_value ->> 'datensicherung' as neu
      from audit_log where table_name = 'procedure_details' order by seq`;
    expect(eintraege.slice(-2)).toEqual([
      { actor: "inhaber-1", action: "INSERT", old: null, neu: "Erste Fassung" },
      { actor: "inhaber-1", action: "UPDATE", old: "Erste Fassung", neu: DETAILS.datensicherung },
    ]);
    await expect(sql`truncate procedure_details`).rejects.toThrow(/nicht geleert/);
  });

  it("kürzt Leerzeichen und lehnt zu lange Angaben ab", async () => {
    await doku.saveProcedureDetails("inhaber-1", { ...DETAILS, verantwortlich: "  Max  " });
    expect((await doku.loadProcedureDetails()).verantwortlich).toBe("Max");
    await expect(doku.saveProcedureDetails("inhaber-1", { ...DETAILS, schluesselablage: "x".repeat(2001) })).rejects.toThrow(/höchstens 2000/);
  });

  it("trägt Datum und Haben-Version als Stand und listet die eingesetzten Versionen", async () => {
    await sql`insert into app_versions (version, postgres_version, started_at) values ('0.8.0', '18.1', '2026-10-01T08:00:00Z')`;
    const document = await doku.procedureDocument(now);
    expect(document.stand).toEqual({ datum: "2026-11-16", programm: "Haben", version: pkg.version });
    const versionen = document.abschnitte.find((a) => a.titel.startsWith("4."))!;
    expect(versionen.liste).toContainEqual(expect.stringMatching(/^Haben 0\.8\.0 seit .*PostgreSQL 18\.1: https:\/\//));
    expect(await doku.procedureMarkdown(now)).toContain(`Stand: 2026-11-16 · Haben ${pkg.version}`);
  });

  it("nennt fehlende Angaben als Lücken und ist erst mit allen vollständig", async () => {
    await seed();
    const leer = await doku.procedureDocument(now);
    expect(leer.vollstaendig).toBe(false);
    expect(leer.abschnitte.flatMap((a) => a.luecken ?? [])).toContain("Beschreibung der Datensicherung (wie, wohin, wie oft, wer die Wiederherstellung prüft)");
    await doku.saveProcedureDetails("inhaber-1", { ...DETAILS });
    const voll = await doku.procedureDocument(now);
    expect(voll.abschnitte.flatMap((a) => a.luecken ?? [])).toEqual([]);
    expect(voll.vollstaendig).toBe(true);
  });

  it("legt die aktuelle Fassung ins Jahresarchiv", async () => {
    await seed();
    await doku.saveProcedureDetails("inhaber-1", { ...DETAILS });
    const { exportYear } = await import("../archiv/index.ts");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportYear(2026, now)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const md = new TextDecoder().decode(files["verfahrensdokumentation.md"]);
    expect(md).toContain("# Verfahrensdokumentation Mustermann IT");
    expect(md).toContain(`Stand: 2026-11-16 · Haben ${pkg.version} · vollständig`);
    expect(md).toContain(DETAILS.serverbetrieb);
    expect(new TextDecoder().decode(files["pruefsummen.sha256"])).toContain("verfahrensdokumentation.md");
    expect(new TextDecoder().decode(files["LIESMICH.txt"])).toContain("verfahrensdokumentation.md");
  });
});
