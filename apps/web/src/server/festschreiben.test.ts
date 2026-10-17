import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

/** Wird während des Renderns von PDF und XML aufgerufen; der Test misst dort, ob die Hash-Kette gesperrt ist */
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

describe.skipIf(!testDatabaseUrl)("Festschreiben: PDF und XML vor der Sperre der Hash-Kette (Postgres)", () => {
  let sql: postgres.Sql;
  let other: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let quotes: typeof import("./quotes.ts");
  let contacts: typeof import("./contacts.ts");
  const actor = "test-user";
  let contactId: string;
  const year = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4));

  /** Ist die Sperre der Hash-Kette gerade von einer anderen Transaktion belegt? (eigene Verbindung, sofort zurückgerollt) */
  async function chainLocked(): Promise<boolean> {
    const [row] = await other.begin((tx) => tx<{ free: boolean }[]>`select pg_try_advisory_xact_lock(hashtext('haben.audit_chain')) as free`);
    return !row!.free;
  }

  const draft = () => ({
    contactId,
    issueDate: `${year}-03-02`,
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format: "zugferd" as const,
    note: "",
    lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: 10_000, taxRate: 1900 as const }],
  });

  beforeAll(async () => {
    sql = await setupTestDb();
    other = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    invoices = await import("./invoices.ts");
    quotes = await import("./quotes.ts");
    contacts = await import("./contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await other?.end();
    await sql?.end();
  });

  beforeEach(async () => {
    rendering.hook = null;
    await sql`truncate quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "10001", name: "Nordwerk Software GmbH", strasse: "Hafenstraße 5", plz: "20457", ort: "Hamburg", land: "DE",
        email: "buchhaltung@nordwerk.example", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      })
    ).id;
  });

  it("die Hash-Kette ist frei, solange PDF und XML einer Rechnung entstehen", async () => {
    const created = await invoices.createDraft(actor, draft());
    const seen: boolean[] = [];
    rendering.hook = async () => {
      seen.push(await chainLocked());
    };
    const final = await invoices.finalizeInvoice(actor, created.id);
    expect(seen).toEqual([false]);
    expect(final).toMatchObject({ status: "final", number: `${year}-001`, numberCounter: 1 });
    expect(final.xml).toContain(`${year}-001`);
    // Und danach: Zähler, Rechnung und Buchung sind in derselben Transaktion geschrieben worden
    const [counter] = await sql`select last from invoice_number_counters where year = ${year}`;
    expect(counter!.last).toBe(1);
    const [entry] = await sql`select locked_at from journal_entries where source_id = ${created.id}`;
    expect(entry!.locked_at).not.toBeNull();
  }, 30_000);

  it("andere Schreibvorgänge laufen, während eine Rechnung gerendert wird", async () => {
    const created = await invoices.createDraft(actor, draft());
    let writtenMeanwhile = false;
    rendering.hook = async () => {
      // Ein Kontakt anlegen schreibt einen Audit-Eintrag; mit gesperrter Kette würde das bis zum Commit warten
      await contacts.createContact(actor, {
        kundennummer: "10002", name: "Südwerk AG", strasse: "Weg 1", plz: "80331", ort: "München", land: "DE",
        email: "", ustId: "", iban: "", leitwegId: "", defaultFormat: null,
      });
      writtenMeanwhile = true;
    };
    await invoices.finalizeInvoice(actor, created.id);
    expect(writtenMeanwhile).toBe(true);
  }, 30_000);

  it("Nummern bleiben lückenlos und eindeutig, auch bei gleichzeitigem Festschreiben", async () => {
    const drafts = await Promise.all(Array.from({ length: 6 }, () => invoices.createDraft(actor, draft())));
    const finals = await Promise.all(drafts.map((d) => invoices.finalizeInvoice(actor, d.id)));
    expect(finals.map((f) => f.numberCounter).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(finals.map((f) => f.number)).size).toBe(6);
    const [counter] = await sql`select last from invoice_number_counters where year = ${year}`;
    expect(counter!.last).toBe(6);
  }, 60_000);

  it("ein Fehler beim Rendern verbraucht keine Nummer", async () => {
    const first = await invoices.createDraft(actor, draft());
    rendering.hook = async () => {
      throw new Error("Renderer abgestürzt");
    };
    await expect(invoices.finalizeInvoice(actor, first.id)).rejects.toThrow(/Renderer abgestürzt/);
    rendering.hook = null;
    const [counter] = await sql`select last from invoice_number_counters where year = ${year}`;
    expect(counter).toBeUndefined();
    expect((await invoices.finalizeInvoice(actor, first.id)).number).toBe(`${year}-001`);
  }, 30_000);

  it("die nächste Nummer festzulegen wartet auf ein laufendes Festschreiben und sieht danach dessen Nummer", async () => {
    const created = await invoices.createDraft(actor, draft());
    let change: Promise<string> | undefined;
    rendering.hook = async () => {
      // Während gerendert wird, hält das Festschreiben den Nummernkreis; setNextNumber wartet bis zum Commit
      change = invoices.setNextNumber(actor, year, 1).then(
        () => "gesetzt",
        (error: Error) => error.message,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
    };
    await invoices.finalizeInvoice(actor, created.id);
    expect(await change).toMatch(new RegExp(`größer als ${year}-001`));
    await invoices.setNextNumber(actor, year, 40);
    const next = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    expect(next.number).toBe(`${year}-040`);
  }, 30_000);

  it("Storno und gleichzeitiges Festschreiben blockieren sich nicht gegenseitig", async () => {
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const other = await invoices.createDraft(actor, draft());
    const today = `${year}-06-01`;
    const [storno, final] = await Promise.all([invoices.cancelInvoice(actor, original.id, today), invoices.finalizeInvoice(actor, other.id)]);
    expect(new Set([storno.number, final.number])).toEqual(new Set([`${year}-002`, `${year}-003`]));
  }, 30_000);

  it("Korrektur festschreiben und dieselbe Rechnung stornieren, gleichzeitig: keine Verklemmung", async () => {
    // finalizeDraft sperrt die korrigierte Rechnung und dann den Nummernkreis; das Storno muss dieselbe Reihenfolge
    // nehmen. Eine eigene Verbindung hält das Original, bis beide warten: die Korrektur zuerst, dann das Storno.
    const original = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draft())).id);
    const correction = await invoices.createCorrection(actor, original.id, `${year}-06-01`);
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const holder = other.begin(async (tx) => {
      await tx`select id from invoices where id = ${original.id} for update`;
      await released;
    });
    await wait(100);
    const outcome = (p: Promise<unknown>, ok: string) => p.then(() => ok, (e: Error) => `${e.message} ${(e as { cause?: Error }).cause?.message ?? ""}`);
    const finalizing = outcome(invoices.finalizeInvoice(actor, correction.id), "korrigiert");
    await wait(300);
    const cancelling = outcome(invoices.cancelInvoice(actor, original.id, `${year}-06-02`), "storniert");
    await wait(300);
    release();
    await holder;
    const results = [await finalizing, await cancelling];
    expect(results.join(" ")).not.toMatch(/deadlock/);
    // Erst die Korrektur, dann das Storno; beides mit Nummer
    expect(results).toEqual(["korrigiert", "storniert"]);
  }, 60_000);

  it("Angebote: Nummer erst nach dem PDF geschrieben, lückenlos auch gleichzeitig", async () => {
    const make = () =>
      quotes.createQuoteDraft(actor, {
        contactId,
        issueDate: `${year}-03-02`,
        validUntil: `${year}-04-30`,
        serviceFrom: null,
        serviceTo: null,
        note: "",
        lines: draft().lines,
      });
    const drafts = await Promise.all([make(), make(), make()]);
    const finals = await Promise.all(drafts.map((d) => quotes.finalizeQuote(actor, d.id)));
    expect(finals.map((f) => f.numberCounter).sort()).toEqual([1, 2, 3]);
    expect(finals.every((f) => f.pdf && f.pdf.subarray(0, 5).toString() === "%PDF-")).toBe(true);
    const [counter] = await sql`select last from quote_number_counters where year = ${year}`;
    expect(counter!.last).toBe(3);
  }, 60_000);
});
