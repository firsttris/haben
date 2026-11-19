import { setTimeout as pause } from "node:timers/promises";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Zähler je Kunde einschalten, während im gemeinsamen Kreis festgeschrieben wird (#1426): Der Kundenkreis beginnt hinter
 * der höchsten Nummer des Kunden im gemeinsamen Kreis. Eine Rechnung, die dort gerade ihre Nummer zieht, darf dabei
 * weder übersehen werden (der Kundenkreis gäbe ihre Nummer noch einmal aus und hinge an „schon vergeben“) noch mit den
 * alten Einstellungen nach dem Einschalten im gemeinsamen Kreis landen.
 */
describe.skipIf(!testDatabaseUrl)("Nummernkreis je Kunde, Einschalten bei parallelem Festschreiben (Postgres, #1426)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let formats: typeof import("./number-formats.ts");
  const actor = "test-user";
  let acme: string;

  const STUFE_1 = { invoice: "RE-{JJJJ}-{KUNDENNR}-{NNN}", quote: "AN-{JJJJ}-{NNN}", invoicePerCustomer: false };
  const JE_KUNDE = { ...STUFE_1, invoicePerCustomer: true };
  const invoiceDraft = () =>
    invoices.createDraft(actor, {
      contactId: acme,
      issueDate: "2026-03-02",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
    });
  const finalize = async () => invoices.finalizeInvoice(actor, (await invoiceDraft()).id, kleinunternehmerStand);
  const settled = <T>(promise: Promise<T>) => Promise.allSettled([promise]).then(([result]) => result!);

  /** Wartet, bis `count` Transaktionen auf eine Advisory-Sperre der blockierenden Verbindung warten */
  const waitForWaiters = async (blocker: postgres.TransactionSql, count: number) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] = await blocker`select count(*)::int as count from pg_locks waiter join pg_locks holder
        on holder.locktype = waiter.locktype and holder.database = waiter.database and holder.classid = waiter.classid
        and holder.objid = waiter.objid and holder.objsubid = waiter.objsubid
        where holder.pid = pg_backend_pid() and holder.locktype = 'advisory' and holder.granted and not waiter.granted`;
      if (row!.count >= count) return;
      await pause(20);
    }
    throw new Error(`Keine ${count} wartenden Transaktionen`);
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("../stammdaten/contacts.ts");
    formats = await import("./number-formats.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters, contact_versions,
      contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "ACME",
      name: "ACME GmbH",
      strasse: "Werkstraße 9",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    acme = contact.id;
    await formats.saveNumberFormats(actor, STUFE_1);
    expect((await finalize()).number).toBe("RE-2026-ACME-001");
  });

  it("zählt eine Rechnung mit, die ihre Nummer im gemeinsamen Kreis vor dem Einschalten zieht", async () => {
    const draft = await invoiceDraft();
    let rechnung: Promise<PromiseSettledResult<{ number: string | null }>> | undefined;
    let einschalten: Promise<PromiseSettledResult<void>> | undefined;
    await sql.begin(async (blocker) => {
      // Die Rechnung hat ihre Nummer gelesen und wartet vor dem Schreiben auf die Hash-Kette; das Einschalten kommt danach
      await blocker`select haben_lock_audit_chain()`;
      rechnung = settled(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand));
      await waitForWaiters(blocker, 1);
      einschalten = settled(formats.saveNumberFormats(actor, JE_KUNDE));
      await waitForWaiters(blocker, 2);
    });
    expect(await rechnung).toMatchObject({ status: "fulfilled", value: { number: "RE-2026-ACME-002" } });
    expect((await einschalten)?.status).toBe("fulfilled");
    expect((await finalize()).number).toBe("RE-2026-ACME-003");
  }, 30_000);

  it("schreibt eine Rechnung, die mit dem gemeinsamen Kreis begonnen hat, nach dem Einschalten nicht mehr dort fest", async () => {
    const draft = await invoiceDraft();
    let rechnung: Promise<PromiseSettledResult<{ number: string | null }>> | undefined;
    await sql.begin(async (blocker) => {
      // Die Rechnung hat die Einstellungen gelesen und wartet auf den gemeinsamen Kreis; währenddessen wird eingeschaltet
      await blocker`select pg_advisory_xact_lock(hashtext('haben.nummernkreis.rechnung.2026'))`;
      rechnung = settled(invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand));
      await waitForWaiters(blocker, 1);
      await formats.saveNumberFormats(actor, JE_KUNDE);
    });
    const ergebnis = await rechnung;
    expect(ergebnis?.status).toBe("rejected");
    expect(String(ergebnis?.status === "rejected" && ergebnis.reason)).toContain("wurden gerade in den Einstellungen geändert");
    const [entwurf] = await sql`select status from invoices where id = ${draft.id}`;
    expect(entwurf!.status).toBe("draft");
    expect((await finalize()).number).toBe("RE-2026-ACME-002");
  }, 30_000);
  it("schreibt auch ein Angebot, das mit dem gemeinsamen Kreis begonnen hat, nach dem Einschalten nicht mehr dort fest", async () => {
    const formate = { ...STUFE_1, quote: "AN-{JJJJ}-{KUNDENNR}-{NNN}", quotePerCustomer: false };
    await formats.saveNumberFormats(actor, formate);
    const quoteDraft = () =>
      quotes.createQuoteDraft(actor, {
        contactId: acme,
        issueDate: "2026-03-02",
        validUntil: "2026-03-31",
        serviceFrom: null,
        serviceTo: null,
        note: "",
        lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
      });
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("AN-2026-ACME-001");
    const draft = await quoteDraft();
    let angebot: Promise<PromiseSettledResult<{ number: string | null }>> | undefined;
    await sql.begin(async (blocker) => {
      await blocker`select pg_advisory_xact_lock(hashtext('haben.nummernkreis.angebot.2026'))`;
      angebot = settled(quotes.finalizeQuote(actor, draft.id));
      await waitForWaiters(blocker, 1);
      await formats.saveNumberFormats(actor, { ...formate, quotePerCustomer: true });
    });
    const ergebnis = await angebot;
    expect(ergebnis?.status).toBe("rejected");
    expect(String(ergebnis?.status === "rejected" && ergebnis.reason)).toContain("wurden gerade in den Einstellungen geändert");
    expect((await quotes.finalizeQuote(actor, (await quoteDraft()).id)).number).toBe("AN-2026-ACME-002");
  }, 30_000);

  it("verklemmt sich nicht, wenn Rechnungen und Angebote zugleich je Kunde zählen und ein durchlaufendes Angebot festgeschrieben wird", async () => {
    const formate = { ...STUFE_1, quote: "AN-{KUNDENNR}-{NNN}", quoteRunning: true, quotePerCustomer: false };
    await formats.saveNumberFormats(actor, formate);
    const quoteDraft = () =>
      quotes.createQuoteDraft(actor, {
        contactId: acme,
        issueDate: "2026-03-02",
        validUntil: "2026-03-31",
        serviceFrom: null,
        serviceTo: null,
        note: "",
        lines: [{ description: "Beratung", quantity: 1000, unit: "Std.", unitPrice: 10_000, taxRate: 1900 }],
      });
    const draft = await quoteDraft();
    let angebot: Promise<PromiseSettledResult<{ number: string | null }>> | undefined;
    let einschalten: Promise<PromiseSettledResult<void>> | undefined;
    await sql.begin(async (blocker) => {
      // Das Einschalten wartet zuerst auf die Kette, dann zieht das Angebot seine Nummer im Kreis 0 und wartet dahinter
      await blocker`select haben_lock_audit_chain()`;
      einschalten = settled(formats.saveNumberFormats(actor, { ...formate, invoicePerCustomer: true, quotePerCustomer: true }));
      await waitForWaiters(blocker, 1);
      angebot = settled(quotes.finalizeQuote(actor, draft.id));
      // Das Angebot wartet auf die Kette oder auf den Kreis 0, den das Einschalten schon hält
      const deadline = Date.now() + 5_000;
      for (;;) {
        const [row] = await blocker`select count(*)::int as count from pg_locks where locktype = 'advisory' and not granted`;
        if (row!.count >= 2) break;
        if (Date.now() > deadline) throw new Error("Das Angebot wartet nicht");
        await pause(20);
      }
    });
    const [e, a] = [await einschalten, await angebot];
    expect(e?.status === "rejected" ? String(e.reason) : "fulfilled").toBe("fulfilled");
    if (a?.status === "rejected") expect(String(a.reason)).toContain("wurden gerade in den Einstellungen geändert");
  }, 30_000);
});
