import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/** Kleinste Datei, die Haben am Inhalt als PDF erkennt; der Text macht jede Datei eindeutig */
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

describe.skipIf(!testDatabaseUrl)("Review: Anhänge an Rechnungen (Postgres)", () => {
  let attachments: typeof import("./attachments.ts");
  let invoices: typeof import("./invoices.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    attachments = await import("./attachments.ts");
    invoices = await import("./invoices.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, invoice_attachments, invoice_lines, invoices, invoice_number_counters, documents,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank')`;
    const stammdaten = await import("../stammdaten/index.ts");
    const contact = await stammdaten.createContact(actor, {
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

  const draft = () =>
    invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });

  /** Wartet, bis eine Verbindung dieser Datenbank auf eine Zeilensperre wartet */
  async function someoneWaitsForLock() {
    for (let i = 0; i < 200; i++) {
      const [row] = await sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
      if (row!.n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("Niemand wartet auf die Sperre");
  }

  it("dieselbe Datei an einer anderen Rechnung geht nicht verloren, wenn sie gleichzeitig an der ersten entfernt wird", async () => {
    const bytes = pdf("Stundenzettel geteilt");
    const a = await draft();
    const b = await draft();
    const old = await attachments.addInvoiceAttachment(actor, a.id, { bytes, filename: "a.pdf" });

    // Eine zweite Verbindung hält die Rechnung B fest, so wartet addInvoiceAttachment nach dem Ablegen der Datei
    const blocker = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const holding = blocker.begin(async (tx) => {
      await tx`select id from invoices where id = ${b.id} for update`;
      locked();
      await held;
    });
    try {
      await isLocked;
      const adding = attachments.addInvoiceAttachment(actor, b.id, { bytes, filename: "b.pdf" });
      await someoneWaitsForLock();
      await attachments.removeInvoiceAttachment(actor, a.id, old.id);
      release();
      await holding;
      const added = await adding;
      expect(added.duplicate).toBe(false);
      expect(new TextDecoder().decode((await attachments.loadInvoiceAttachment(added.id))!.bytes)).toContain("Stundenzettel geteilt");
      expect(new TextDecoder().decode(await storage.loadFile(storage.sha256Of(bytes)))).toContain("Stundenzettel geteilt");
    } finally {
      release();
      await holding.catch(() => {});
      await blocker.end();
    }
  });

  it("ein Beleg mit derselben Datei nimmt sie beim Löschen nicht mit, solange ein Anhang sie nutzt", async () => {
    const belege = await import("../belege/index.ts");
    const bytes = pdf("geteilt mit Beleg");
    const { id } = await draft();
    const attachment = await attachments.addInvoiceAttachment(actor, id, { bytes, filename: "anhang.pdf" });
    const doc = await belege.uploadDocument(actor, { bytes, filename: "beleg.pdf" });
    await belege.deleteDocument(actor, doc.id);
    expect((await attachments.loadInvoiceAttachment(attachment.id))?.filename).toBe("anhang.pdf");
  });

  it("die Integritätsprüfung meldet einen nachträglich geänderten Anhang einer festgeschriebenen Rechnung", async () => {
    const { id } = await draft();
    const { id: attachmentId } = await attachments.addInvoiceAttachment(actor, id, { bytes: pdf("Original"), filename: "original.pdf" });
    await invoices.finalizeInvoice(actor, id);
    await sql.begin(async (tx) => {
      await tx`alter table invoice_attachments disable trigger invoice_attachments_locked`;
      await tx`update invoice_attachments set sha256 = ${storage.sha256Of(pdf("Fälschung"))} where id = ${attachmentId}`;
      await tx`alter table invoice_attachments enable trigger invoice_attachments_locked`;
    });
    const problems = await sql`select tabelle, zeile, befund from haben_integrity_problems() where art = 'siegel'`;
    expect(problems).toEqual([{ tabelle: "invoices", zeile: id, befund: "Inhalt passt nicht zum Siegel" }]);
  });
});
