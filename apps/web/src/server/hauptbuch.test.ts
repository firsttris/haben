import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

/** Fehlermeldung samt Ursache: Drizzle verpackt den Fehler der Datenbank in „Failed query“ */
async function failure(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  throw new Error("Erwartet war ein Fehler");
}

/** Dateien unter server/ ohne Tests, rekursiv */
function serverSources(dir = fileURLToPath(new URL(".", import.meta.url))): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return serverSources(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "test-db.ts" ? [path] : [];
  });
}

describe("Hauptbuch als einziger Schreiber des Journals", () => {
  it("nur ledger.ts schreibt journal_entries und journal_lines", () => {
    const writes = /\.(insert|update|delete)\(schema\.journal(Entries|Lines)\)|(insert\s+into|update|delete\s+from)\s+journal_(entries|lines)\b/i;
    const offenders = serverSources()
      .filter((file) => !file.endsWith(`${join("server", "ledger.ts")}`))
      .filter((file) => writes.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    // Die Prüfung erkennt, was sie erkennen soll
    expect(writes.test("await tx.insert(schema.journalEntries).values(x)")).toBe(true);
    expect(writes.test("await tx.update(schema.journalLines).set(x)")).toBe(true);
    expect(writes.test("insert into journal_lines (entry_id) values ($1)")).toBe(true);
    expect(writes.test("await tx.select().from(schema.journalEntries)")).toBe(false);
  });
});

describe.skipIf(!testDatabaseUrl)("Hauptbuch, Transaktionen und Sperre der Firmendaten (Postgres)", () => {
  let sql: postgres.Sql;
  let ledger: typeof import("./ledger.ts");
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("./contacts.ts");
  let guard: typeof import("./settings-guard.ts");
  let company: typeof import("./company.ts");
  let withActor: (typeof import("./db/actor.ts"))["withActor"];
  const actor = "test-user";
  let contactId: string;
  const year = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4));
  const today = `${year}-06-15`;

  const lines = (amount: number) => [
    { account: "1400", debit: amount, credit: 0, taxCode: null },
    { account: "8400", debit: 0, credit: amount, taxCode: null },
  ];

  const invoiceDraft = () => ({
    contactId,
    issueDate: `${year}-06-01`,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: 10_000, taxRate: 1900 as const }],
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    ledger = await import("./ledger.ts");
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("./contacts.ts");
    guard = await import("./settings-guard.ts");
    company = await import("./company.ts");
    ({ withActor } = await import("./db/actor.ts"));
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  });

  describe("ledger.post", () => {
    it("bucht, schreibt fest und versiegelt, im Kontenrahmen der Firmendaten", async () => {
      const reversed = await withActor(actor, async (tx) => ledger.post(tx, await ledger.openBooks(tx), {
        date: `${year}-03-01`,
        description: "Erste",
        sourceType: "kasse",
        sourceId: crypto.randomUUID(),
        lines: lines(500),
      }));
      const id = await withActor(actor, async (tx) => ledger.post(tx, await ledger.openBooks(tx), {
        date: `${year}-03-02`,
        description: "Storno",
        sourceType: "kasse",
        sourceId: crypto.randomUUID(),
        reversesId: reversed,
        // Zeilen ohne Betrag fallen weg
        lines: [...lines(500).map((l) => ({ ...l, debit: l.credit, credit: l.debit })), { account: "1200", debit: 0, credit: 0, taxCode: null }],
      }));
      const [entry] = await sql`select kontenrahmen, reverses_id, locked_at from journal_entries where id = ${id}`;
      expect(entry).toMatchObject({ kontenrahmen: "SKR03", reverses_id: reversed });
      expect(entry!.locked_at).not.toBeNull();
      const rows = await sql`select account, debit, credit from journal_lines where entry_id = ${id} order by account`;
      expect(rows).toEqual([
        { account: "1400", debit: 0, credit: 500 },
        { account: "8400", debit: 500, credit: 0 },
      ]);
      const [seal] = await sql`select genesis from seals where table_name = 'journal_entries' and row_id = ${id}`;
      expect(seal).toEqual({ genesis: false });
      // Mit Audit-Eintrag des Nutzers
      const [audit] = await sql`select actor from audit_log where table_name = 'journal_entries' and row_id = ${id} and action = 'INSERT'`;
      expect(audit).toEqual({ actor });
    });

    it("lehnt eine unausgeglichene Buchung ab und lässt nichts zurück", async () => {
      expect(
        await failure(
          withActor(actor, async (tx) =>
            ledger.post(tx, await ledger.openBooks(tx), {
              date: `${year}-03-01`,
              description: "Schief",
              sourceType: "kasse",
              sourceId: crypto.randomUUID(),
              lines: [{ account: "1400", debit: 500, credit: 0, taxCode: null }, { account: "8400", debit: 0, credit: 400, taxCode: null }],
            }),
          ),
        ),
      ).toMatch(/nicht ausgeglichen \(Differenz 100, 2 Zeilen\)/);
      expect(
        await failure(
          withActor(actor, async (tx) =>
            ledger.post(tx, await ledger.openBooks(tx), { date: `${year}-03-01`, description: "Leer", sourceType: "kasse", sourceId: crypto.randomUUID(), lines: [] }),
          ),
        ),
      ).toMatch(/nicht ausgeglichen \(Differenz 0, 0 Zeilen\)/);
      const [n] = await sql`select count(*)::int as n from journal_entries`;
      expect(n!.n).toBe(0);
    });

    it("lehnt ab, wenn sich die Firmendaten zwischen Lesen und Buchen geändert haben", async () => {
      const other = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
      try {
        // Versteuerung: die Datenbank sieht der Buchung das nicht an, post vergleicht nach dem Einfügen
        await sql`update company set versteuerung = 'soll'`;
        await expect(
          withActor(actor, async (tx) => {
            const books = await ledger.openBooks(tx);
            await other`update company set versteuerung = 'ist'`;
            return ledger.post(tx, books, { date: `${year}-03-01`, description: "Alt", sourceType: "kasse", sourceId: crypto.randomUUID(), lines: lines(100) });
          }),
        ).rejects.toThrow(/gerade geändert/);
        // Kontenrahmen: schon die Datenbank lehnt ab
        expect(
          await failure(
            withActor(actor, async (tx) => {
              const books = await ledger.openBooks(tx);
              await other`update company set kontenrahmen = 'SKR04'`;
              return ledger.post(tx, books, { date: `${year}-03-01`, description: "Alt", sourceType: "kasse", sourceId: crypto.randomUUID(), lines: lines(100) });
            }),
          ),
        ).toMatch(/Kontenrahmen SKR03, die Firmendaten stehen auf SKR04/);
        const [n] = await sql`select count(*)::int as n from journal_entries`;
        expect(n!.n).toBe(0);
      } finally {
        await other.end();
      }
    });
  });

  describe("eine Transaktion je Anwendungsfall", () => {
    it("Storno: scheitert das Festschreiben, bleibt kein Entwurf und keine Nummer zurück", async () => {
      const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      // Firmendaten unvollständig: Festschreiben lehnt ab
      await sql`update company set steuernummer = '', ust_id = ''`;
      await expect(invoices.cancelInvoice(actor, original.id, `${year}-06-20`)).rejects.toThrow(/Noch nicht bereit/);
      const rows = await sql`select kind, status from invoices order by created_at`;
      expect(rows).toEqual([{ kind: "rechnung", status: "final" }]);
      const [counter] = await sql`select last from invoice_number_counters where year = ${year}`;
      expect(counter!.last).toBe(1);
      const [entries] = await sql`select count(*)::int as n from journal_entries`;
      expect(entries!.n).toBe(1);

      // Danach klappt es, mit der nächsten Nummer ohne Lücke
      await sql`update company set steuernummer = '198/113/10010', ust_id = 'DE123456789'`;
      const storno = await invoices.cancelInvoice(actor, original.id, `${year}-06-20`);
      expect(storno.number).toBe(`${year}-002`);
    }, 30_000);

    it("Angebot zur Rechnung: gleichzeitig zweimal ergibt genau einen Entwurf", async () => {
      const quote = await quotes.finalizeQuote(
        actor,
        (
          await quotes.createQuoteDraft(actor, {
            contactId,
            issueDate: `${year}-06-01`,
            validUntil: `${year}-06-30`,
            serviceFrom: null,
            serviceTo: null,
            note: "",
            lines: invoiceDraft().lines,
          })
        ).id,
      );
      const results = await Promise.allSettled([
        quotes.quoteToInvoice(actor, quote.id, `${year}-06-10`),
        quotes.quoteToInvoice(actor, quote.id, `${year}-06-10`),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/bereits eine Rechnung/);
      const drafts = await sql`select id from invoices`;
      expect(drafts).toHaveLength(1);
      const [linked] = await sql`select invoice_id from quotes where id = ${quote.id}`;
      expect(linked!.invoice_id).toBe(drafts[0]!.id);
    }, 30_000);
  });

  describe("Sperre der Firmendaten im Anwendungsfall", () => {
    it("saveCompany prüft die Sperre selbst, für jeden Zugang", async () => {
      const before = company.companySchema.parse(await company.loadCompany());
      // Ohne Buchungen frei
      await guard.saveCompany(actor, { ...before, versteuerung: "ist" }, today);
      await guard.saveCompany(actor, { ...before, versteuerung: "soll" }, today);
      const current = company.companySchema.parse(await company.loadCompany());

      await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      await expect(guard.saveCompany(actor, { ...current, kontenrahmen: "SKR04" }, today)).rejects.toThrow(
        new RegExp(`Kontenrahmen: Im Jahr ${year} gibt es schon Buchungen`),
      );
      await expect(guard.saveCompany(actor, { ...current, kleinunternehmer: true }, today)).rejects.toThrow(/Kleinunternehmer: /);
      // Andere Felder bleiben änderbar, nichts Gesperrtes wurde gespeichert
      await guard.saveCompany(actor, { ...current, name: "Testfirma GmbH" }, today);
      expect(await company.loadCompany()).toMatchObject({ name: "Testfirma GmbH", kontenrahmen: "SKR03", kleinunternehmer: false });
    }, 30_000);

    it("die Datenbank lehnt auch ab, wenn die App ein anderes Datum annimmt", async () => {
      const current = company.companySchema.parse(await company.loadCompany());
      await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, invoiceDraft())).id);
      // Mit einem Datum im Folgejahr meldet die App keine Sperre; die Datenbank rechnet mit dem echten Jahr
      expect(await failure(guard.saveCompany(actor, { ...current, kontenrahmen: "SKR04" }, `${year + 1}-01-02`))).toMatch(/Im Jahr \d+ gibt es schon Buchungen/);
      expect((await company.loadCompany()).kontenrahmen).toBe("SKR03");
    }, 30_000);
  });
});
