import { startvorlage } from "@haben/einvoice";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Mahnwesen (Postgres)", () => {
  let dunning: typeof import("./dunning.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let layouts: typeof import("../stammdaten/layouts.ts");
  let sql: postgres.Sql;
  let invoiceId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    dunning = await import("./dunning.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    layouts = await import("../stammdaten/layouts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate dunnings, journal_lines, journal_entries, invoice_lines, invoices, recurring_invoices, invoice_number_counters,
      contact_versions, contacts, company, beleg_layouts cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, dunning)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank',
              '{"baseRate": 127, "fees": {"1": 0, "2": 500, "3": 1000}, "deadlineDays": 10}'::jsonb)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
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
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-09-01",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    invoiceId = (await invoices.finalizeInvoice(actor, draft.id)).id;
  }, 30_000);

  it("unbekannte Rechnung: kein Vorschlag statt Fachfehler, damit die Mahnungsseite 404 zeigt", async () => {
    expect(await dunning.dunningDraft("00000000-0000-4000-8000-000000000000", "2026-10-15")).toBeNull();
  });

  it("überfällige Rechnung: Vorschlag, Mahnung mit Zinsen und PDF, danach nächste Stufe", async () => {
    // fällig am 15.09.2026
    const [overdue] = await dunning.overdueInvoices("2026-10-15");
    expect(overdue).toMatchObject({ id: invoiceId, nextLevel: 1, waiting: false, lastDunning: null });

    const draft = await dunning.dunningDraft(invoiceId, "2026-10-15");
    expect(draft).toMatchObject({ level: 1, dueDate: "2026-10-25", fee: 0, baseRate: 127 });

    const created = await dunning.createDunning(
      actor,
      { invoiceId, level: 2, dueDate: "2026-10-25", fee: 500, flatFee: true, interest: "geschaeftskunde", intro: "Bitte zahlen.", closing: "" },
      "2026-10-15",
    );
    // 1.190 € zu 10,27 % für 30 Tage = 10,04 €; die Mahngebühr von 5 € geht in der Pauschale von 40 € auf
    expect(created).toMatchObject({ level: 2, open: 119_000, fee: 0, flatFee: 4_000, interest: 1_004, interestRate: 1_027, interestDays: 30, total: 124_004 });
    const pdf = await dunning.loadDunningPdf(created.id);
    expect(Buffer.from(pdf!.pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf!.filename).toMatch(/^Mahnung-2026-001\.pdf$/);

    const [after] = await dunning.overdueInvoices("2026-10-20");
    expect(after).toMatchObject({ nextLevel: 3, waiting: true });
    await expect(sql`delete from dunnings`).rejects.toThrow("darf nur ergänzt werden");
  });

  it("keine zweite Mahnung derselben oder einer niedrigeren Stufe, auch nicht gleichzeitig", async () => {
    const input = { invoiceId, level: 1 as const, dueDate: "2026-10-25", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
    const results = await Promise.allSettled([dunning.createDunning(actor, input, "2026-10-15"), dunning.createDunning(actor, input, "2026-10-15")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/schon mit „Zahlungserinnerung“ gemahnt/);
    await dunning.createDunning(actor, { ...input, level: 3 }, "2026-10-16");
    await expect(dunning.createDunning(actor, { ...input, level: 2 }, "2026-10-17")).rejects.toThrow(/Als Nächstes folgt „Letzte Mahnung“/);
    // Die letzte Stufe darf sich wiederholen
    expect((await dunning.createDunning(actor, { ...input, level: 3 }, "2026-10-17")).level).toBe(3);
  });

  it("lehnt Mahnungen vor Fälligkeit und mit Frist in der Vergangenheit ab", async () => {
    const input = { invoiceId, level: 1 as const, dueDate: "2026-09-20", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
    await expect(dunning.createDunning(actor, input, "2026-09-10")).rejects.toThrow("noch nicht fällig");
    await expect(dunning.createDunning(actor, input, "2026-10-01")).rejects.toThrow("in der Zukunft");
  });

  describe("Vorschau", () => {
    const form = (overrides: Partial<import("./dunning.ts").DunningPreviewInput> = {}) =>
      dunning.dunningPreviewSchema.parse({
        invoiceId,
        level: 1,
        dueDate: "2026-10-25",
        fee: 500,
        flatFee: false,
        interest: null,
        intro: "Bitte *zahlen* Sie.",
        closing: "",
        design: {},
        ...overrides,
      });
    const text = (parts: { lines: string[] }[]) =>
      parts
        .flatMap((part) => part.lines)
        .join("\n")
        .replace(/\s/g, " ");
    /** Ohne Glyphen und data-tid, die Typst nicht stabil vergibt */
    const gesetzt = (svg: string) => svg.replace(/<defs class="glyph">[\s\S]*?<\/defs>/, "").replace(/ data-tid="[^"]*"/g, "");

    it("setzt das Blatt aus dem Formular mit Gebühr und speichert nichts", async () => {
      const result = await dunning.dunningPreview(form(), "2026-10-15");
      expect(result.svg.startsWith("<svg")).toBe(true);
      expect(text(result.text)).toContain("Zahlungserinnerung");
      expect(text(result.text)).toContain("Bitte zahlen Sie.");
      expect(text(result.text)).toContain("Zu zahlen: 1.195,00 €");
      expect(text(result.text)).toContain("bis zum 25.10.2026");
      expect(await sql`select id from dunnings`).toHaveLength(0);
      expect((await dunning.dunningDraft(invoiceId, "2026-10-15"))?.level).toBe(1);
    }, 60_000);

    it("zeigt auch ein unfertiges Formular: leere Einleitung, Frist leer oder vorbei", async () => {
      const leer = await dunning.dunningPreview(form({ intro: "", dueDate: "" }), "2026-10-15");
      expect(text(leer.text)).toContain("bis zum 15.10.2026");
      const vorbei = await dunning.dunningPreview(form({ dueDate: "2026-10-01" }), "2026-10-15");
      expect(text(vorbei.text)).toContain("bis zum 01.10.2026");
      // Erstellen prüft die Frist weiter
      const { design: _design, ...input } = form({ dueDate: "2026-10-01" });
      await expect(dunning.createDunning(actor, input, "2026-10-15")).rejects.toThrow("in der Zukunft");
    }, 60_000);

    it("lehnt eine Gebühr über der Grenze ab wie Entwurf und Erstellen, statt sie wegzulassen", () => {
      const eingabe = { invoiceId, level: 1, dueDate: "2026-10-25", fee: 100_001, flatFee: false, interest: null, intro: "x", closing: "" };
      expect(dunning.dunningInputSchema.safeParse(eingabe).success).toBe(false);
      expect(dunning.dunningPreviewSchema.safeParse({ ...eingabe, design: {} }).success).toBe(false);
    });

    it("setzt mit dem eigenen Layout für Mahnungen", async () => {
      const eingebaut = await dunning.dunningPreview(form(), "2026-10-15");
      const source = `${startvorlage("mahnung")}\n#place(top + left, dx: 5mm, dy: 5mm, rect(width: 30mm, height: 10mm, fill: rgb("#123456")))\n`;
      const created = await layouts.createLayout(actor, { name: "Rot", art: "mahnung", source });
      if (!("id" in created)) throw new Error("Rückfrage statt Anlegen");
      await layouts.assignLayout(actor, "mahnung", { kind: "eigen", id: created.id });
      const eigen = await dunning.dunningPreview(form(), "2026-10-15");
      expect(gesetzt(eigen.svg)).not.toBe(gesetzt(eingebaut.svg));
      expect(eigen.svg).toContain("#123456");
      expect(eingebaut.svg).not.toContain("#123456");
    }, 120_000);
  });
});
