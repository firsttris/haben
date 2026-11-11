import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Kleinunternehmer: technische Erstanlage und fachliche Einstellung (Postgres)", () => {
  let sql: postgres.Sql;
  let company: typeof import("./company.ts");
  let guard: typeof import("./settings-guard.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const previous = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  const actor = "test:firmeneinrichtung";

  beforeAll(async () => {
    sql = await setupTestDb();
    company = await import("./company.ts");
    guard = await import("./settings-guard.ts");
    fristen = await import("../finanzamt/fristen.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate journal_lines, journal_entries, vat_return_submissions, vat_returns, annual_submissions, company, seals, audit_log, audit_chain cascade`;
    await sql`insert into audit_chain (id, seq, hash) values (1, 0, haben_audit_genesis())`;
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ] as const)("erste fachliche Speicherung als Kleinunternehmer gilt auch vor der Einrichtung (%s, %s)", async (kontenrahmen, versteuerung) => {
    // Authentifizierung und Einstellungen lesen die Firma schon vor der ersten Speicherung.
    const initial = await company.loadCompany();
    expect(initial.kleinunternehmer).toBe(false);
    await company.loadCompany();
    await guard.saveCompany(
      actor,
      company.companySchema.parse({ ...initial, name: "Musterbetrieb", kleinunternehmer: true, kontenrahmen, versteuerung }),
      today,
    );

    const stand = await company.kleinunternehmerHistory();
    expect(stand(previous)).toBe(true);
    expect(stand(today)).toBe(true);
    expect(await company.kleinunternehmerForMonth(Number(previous.slice(0, 4)), Number(previous.slice(5, 7)))).toBe(true);
    expect(await company.kleinunternehmerForYear(year - 1)).toBe(true);
    const [record] = await sql`select count(*)::int as count from audit_log where table_name = 'company'`;
    expect(record!.count).toBe(2);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("technische Anlage in einer Transaktion erhält eigenen Akteur und lässt den fachlichen Akteur bestehen", async () => {
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    await withActor(actor, async (tx) => {
      await company.loadCompany(tx);
      await tx.update(schema.company).set({ name: "Übernommene Musterfirma", kleinunternehmer: true });
    });
    const entries = await sql`select action, actor from audit_log where table_name = 'company' order by seq`;
    expect(entries).toEqual([
      { action: "INSERT", actor: "system:setup" },
      { action: "UPDATE", actor },
    ]);
    expect((await company.kleinunternehmerHistory())(previous)).toBe(true);
    expect(await sql`select * from haben_integrity_problems(100)`).toEqual([]);
  });

  it("Übernahme nach automatischer Erstanlage funktioniert unabhängig vom Namen des Importeurs", async () => {
    await company.loadCompany();
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    await withActor("migration:anderes-programm", (tx) => tx.update(schema.company).set({ name: "Musterfirma", kleinunternehmer: true }));
    expect((await company.kleinunternehmerHistory())(previous)).toBe(true);
  });

  it("bewusst gespeicherte Regelbesteuerung bleibt vor einem echten Wechsel bestehen", async () => {
    const initial = await company.loadCompany();
    const regular = company.companySchema.parse({ ...initial, name: "Musterbetrieb", kleinunternehmer: false });
    await guard.saveCompany(actor, regular, today);
    await guard.saveCompany(actor, { ...regular, kleinunternehmer: true }, today);
    const history = await company.kleinunternehmerHistory();
    expect(history(previous)).toBe(false);
    expect(history(today)).toBe(true);
  });

  it("auch ein unter system:setup gespeicherter späterer Wechsel bleibt fachlich wirksam", async () => {
    const initial = await company.loadCompany();
    await guard.saveCompany(actor, company.companySchema.parse({ ...initial, name: "Musterbetrieb", kleinunternehmer: false }), today);
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    await withActor("system:setup", (tx) => tx.update(schema.company).set({ kleinunternehmer: true }));
    expect((await company.kleinunternehmerHistory())(previous)).toBe(false);
    expect((await company.kleinunternehmerHistory())(today)).toBe(true);
  });

  it("ein benanntes Ausgangsprofil unter system:setup ist keine leere technische Vorgabe", async () => {
    const { withActor } = await import("../../db/actor.ts");
    const { schema } = await import("../../db/index.ts");
    await withActor("system:setup", (tx) => tx.insert(schema.company).values({ id: 1, name: "Bestätigte Musterfirma", kleinunternehmer: false }));
    await guard.saveCompany(actor, company.companySchema.parse({ ...(await company.loadCompany()), kleinunternehmer: true }), today);
    expect((await company.kleinunternehmerHistory())(previous)).toBe(false);
  });

  it("technische Anlage ohne vorherigen Transaktionsakteur hinterlässt keinen system:setup-Akteur", async () => {
    const { db, schema } = await import("../../db/index.ts");
    await db.transaction(async (tx) => {
      await company.loadCompany(tx);
      await tx.update(schema.company).set({ name: "Musterfirma", kleinunternehmer: true });
    });
    const entries = await sql`select action, actor from audit_log where table_name = 'company' order by seq`;
    expect(entries).toEqual([
      { action: "INSERT", actor: "system:setup" },
      { action: "UPDATE", actor: null },
    ]);
    expect((await company.kleinunternehmerHistory())(previous)).toBe(true);
  });

  it("technischer Standard ohne fachlichen Eintrag bleibt lesbar und schreibt beim Auswerten nichts um", async () => {
    await company.loadCompany();
    const before = await sql`select seq, row_hash from audit_log where table_name = 'company' order by seq`;
    expect((await company.kleinunternehmerHistory())(previous)).toBe(false);
    expect(await sql`select seq, row_hash from audit_log where table_name = 'company' order by seq`).toEqual(before);
  });

  it("Fristen enthalten nach der Kleinunternehmer-Ersteinrichtung keine vermeintlichen regulären Voranmeldungen", async () => {
    const initial = await company.loadCompany();
    await guard.saveCompany(actor, company.companySchema.parse({ ...initial, name: "Musterfirma", kleinunternehmer: true }), today);
    await sql.begin(async (tx) => {
      const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${`${year}-01-01`}, 'Einlage Test', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values
        (${entry!.id}, '1000', 100, 0), (${entry!.id}, '1890', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
    });
    expect((await fristen.listFristen(today)).filter((f) => f.art === "ustva")).toEqual([]);
  });

  it("bereits für eine Buchung verwendete Vorgaben bleiben vor einem späteren Wechsel erhalten", async () => {
    const initial = await company.loadCompany();
    await sql.begin(async (tx) => {
      const [entry] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${`${year - 1}-12-10`}, 'Bestehende Regelbesteuerung', 'manuell', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit, tax_code) values
        (${entry!.id}, '1400', 11900, 0, null), (${entry!.id}, '8400', 0, 10000, 'USt19'), (${entry!.id}, '1776', 0, 1900, 'USt19')`;
      await tx`update journal_entries set locked_at = now() where id = ${entry!.id}`;
    });
    await guard.saveCompany(actor, company.companySchema.parse({ ...initial, name: "Musterfirma", kleinunternehmer: true }), today);
    expect(await company.kleinunternehmerForYear(year - 1)).toBe(false);
    expect((await company.kleinunternehmerHistory())(today)).toBe(true);
  });
});
