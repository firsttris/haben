import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const rendering = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }));

vi.mock("@haben/einvoice", async (importOriginal) => {
  const original = await importOriginal<typeof import("@haben/einvoice")>();
  return {
    ...original,
    buildEInvoice: async (...args: Parameters<typeof original.buildEInvoice>) => {
      await rendering.hook?.();
      return original.buildEInvoice(...args);
    },
  };
});

/**
 * #750: Eine unbezahlte Anforderung hat noch keine Journalbuchung, ihr festgeschriebenes Bilanzverfahren gehört aber
 * weiterhin zur GmbH/UG. Der Wechsel zur EÜR darf diese Entscheidung weder in der App noch am SQL-Weg umgehen.
 * Entscheidung: https://github.com/firsttris/haben/issues/750#issuecomment-6837873675
 */
describe.skipIf(!testDatabaseUrl)("Rechtsform nach festgeschriebener Anzahlungsanforderung (Postgres)", () => {
  let sql: postgres.Sql;
  let company: typeof import("./company.ts");
  let guard: typeof import("./settings-guard.ts");
  let contacts: typeof import("./contacts.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let database: typeof import("../../db/index.ts");
  let withActor: typeof import("../../db/actor.ts")["withActor"];
  let contactId: string;
  const actor = "advance-settings-test";
  const today = "2026-12-02";

  beforeAll(async () => {
    sql = await setupTestDb();
    company = await import("./company.ts");
    guard = await import("./settings-guard.ts");
    contacts = await import("./contacts.ts");
    invoices = await import("../rechnungen/index.ts");
    database = await import("../../db/index.ts");
    ({ withActor } = await import("../../db/actor.ts"));
  });
  afterAll(async () => {
    await sql?.end();
  });
  beforeEach(async () => {
    rendering.hook = null;
    await leeren(sql)`truncate seals, audit_log, company, invoices, invoice_number_counters, contacts, journal_entries cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, bundesland, iban, kontenrahmen, versteuerung, rechtsform, journal_ab)
      values (1, 'Muster GmbH', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '0941 1', '198/113/10010',
        'BY', 'DE89370400440532013000', 'SKR03', 'soll', 'gmbh', 2026)`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "rechnung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  async function draft() {
    return invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-12-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      variant: "abschlag",
      advanceType: "anzahlung",
      lines: [{ description: "Anzahlung vor Leistung", quantity: 1000, unit: "Psch.", unitPrice: 30_000, taxRate: 1900 }],
    });
  }

  it.each([
    ["gmbh", "SKR03", "soll"],
    ["ug", "SKR04", "ist"],
  ] as const)("%s, %s, %s: trotz null Journalbuchungen bleibt das finale Bilanzverfahren gegen Rechtsformwechsel geschützt", async (form, frame, mode) => {
    await sql`update company set rechtsform = ${form}, kontenrahmen = ${frame}, versteuerung = ${mode}`;
    const finalized = await invoices.finalizeInvoice(actor, (await draft()).id);
    expect(finalized.advanceAccounting).toBe("deferred");
    expect(await sql`select id from journal_entries`).toEqual([]);
    const sealed = await sql`select digest, columns from seals where table_name = 'invoices' and row_id = ${finalized.id}`;

    expect((await guard.settingsLocks(today)).rechtsform).toMatch(/festgeschriebene.*Anzahlungsanforderung/);
    const current = company.companySchema.parse(await company.loadCompany());
    await expect(guard.saveCompany(actor, { ...current, rechtsform: "einzelunternehmen" }, today)).rejects.toThrow(/^Rechtsform:.*Anzahlungsanforderung/);

    expect((await company.loadCompany()).rechtsform).toBe(form);
    expect(await sql`select advance_accounting from invoices where id = ${finalized.id}`).toEqual([{ advance_accounting: "deferred" }]);
    expect(await sql`select digest, columns from seals where table_name = 'invoices' and row_id = ${finalized.id}`).toEqual(sealed);
  });

  it("auch direkter SQL-Wechsel kann die finale Anzahlungsentscheidung ohne Journal nicht umgehen", async () => {
    const finalized = await invoices.finalizeInvoice(actor, (await draft()).id);
    expect(await sql`select id from journal_entries`).toEqual([]);
    await expect(sql`update company set rechtsform = 'einzelunternehmen' where id = 1`).rejects.toThrow(/festgeschriebene.*Anzahlungsanforderung/);
    expect((await company.loadCompany()).rechtsform).toBe("gmbh");
    expect(await sql`select advance_accounting from invoices where id = ${finalized.id}`).toEqual([{ advance_accounting: "deferred" }]);
  });

  it("die neue Rechtsformsperre sperrt ohne Buchung keinen Kontenrahmenwechsel und keine gewöhnlichen Firmendaten", async () => {
    const finalized = await invoices.finalizeInvoice(actor, (await draft()).id);
    const locks = await guard.settingsLocks(today);
    expect(locks.kontenrahmen).toBeNull();
    expect(locks.kleinunternehmer).toBeNull();
    // Die bestehende Sperre der Versteuerung wegen offener Rechnungen bleibt unverändert.
    expect(locks.versteuerung).toMatch(/noch offen/);
    const current = company.companySchema.parse(await company.loadCompany());
    await guard.saveCompany(actor, { ...current, kontenrahmen: "SKR04", name: "Neue Anschrift GmbH" }, today);
    expect(await company.loadCompany()).toMatchObject({ rechtsform: "gmbh", kontenrahmen: "SKR04", name: "Neue Anschrift GmbH" });
    expect(await sql`select id from journal_entries`).toEqual([]);
    expect(await sql`select advance_accounting from invoices where id = ${finalized.id}`).toEqual([{ advance_accounting: "deferred" }]);
  });

  it("ein echter offener Entwurf legt die Rechtsform noch nicht fest", async () => {
    const open = await draft();
    expect(open).toMatchObject({ status: "draft", advanceAccounting: null });
    expect((await guard.settingsLocks(today)).rechtsform).toBeNull();
    const current = company.companySchema.parse(await company.loadCompany());
    await guard.saveCompany(actor, { ...current, rechtsform: "einzelunternehmen" }, today);
    expect((await company.loadCompany()).rechtsform).toBe("einzelunternehmen");
    expect(await sql`select id from journal_entries`).toEqual([]);
  });

  it("ein finaler Bestandsbeleg mit null-Marker löst ohne Journal keine zusätzliche Rechtsformsperre aus", async () => {
    const old = await draft();
    // Unveränderlicher Beleg aus dem bisherigen Verfahren; die bestehende Journal-Sperre prüft rechtsform.test.ts.
    await withActor(actor, (tx) =>
      tx
        .update(database.schema.invoices)
        .set({ status: "final", number: "ALT-2026-001", advanceAccounting: null, lockedAt: new Date() })
        .where(eq(database.schema.invoices.id, old.id)),
    );
    expect((await guard.settingsLocks(today)).rechtsform).toBeNull();
    const current = company.companySchema.parse(await company.loadCompany());
    await guard.saveCompany(actor, { ...current, rechtsform: "einzelunternehmen" }, today);
    expect((await company.loadCompany()).rechtsform).toBe("einzelunternehmen");
    expect(await sql`select advance_accounting from invoices where id = ${old.id}`).toEqual([{ advance_accounting: null }]);
    expect(await sql`select id from journal_entries`).toEqual([]);
  });

  it("ein während des Renderns bereits abgeschlossener Rechtsformwechsel verhindert den veralteten GmbH-Marker", async () => {
    const created = await draft();
    const current = company.companySchema.parse(await company.loadCompany());
    let switched = false;
    rendering.hook = async () => {
      rendering.hook = null;
      // Wie festschreiben.test.ts: vor dem ersten Audit-Schreiben ist die Kette frei. Kein Timing mit Sleeps:
      // Die zweite echte Transaktion muss committed sein, bevor die erste ihre Festschreibung fortsetzt.
      expect(await sql`select status, advance_accounting from invoices where id = ${created.id}`).toEqual([{ status: "draft", advance_accounting: null }]);
      expect(await sql`select id from journal_entries`).toEqual([]);
      await guard.saveCompany(actor, { ...current, rechtsform: "einzelunternehmen" }, today);
      switched = true;
    };
    const failure = await invoices.finalizeInvoice(actor, created.id).then(
      () => null,
      (error: Error & { cause?: Error }) => `${error.message} ${error.cause?.message ?? ""}`,
    );
    expect(switched).toBe(true);
    expect(failure).toMatch(/Rechtsform.*(geändert|GmbH|UG)/);
    expect((await company.loadCompany()).rechtsform).toBe("einzelunternehmen");
    expect(await sql`select status, advance_accounting, number, locked_at from invoices where id = ${created.id}`).toEqual([
      { status: "draft", advance_accounting: null, number: null, locked_at: null },
    ]);
    expect(await sql`select id from journal_entries`).toEqual([]);
    expect(await sql`select row_id from seals where table_name = 'invoices' and row_id = ${created.id}`).toEqual([]);
  });
});
