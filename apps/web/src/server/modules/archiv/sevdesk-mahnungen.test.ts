import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Mahnungen aus sevDesk (#472): nur Archiv, verknüpft mit der gemahnten Rechnung, ohne Wirkung auf Abgleich, offene
 * Posten, Umsatzsteuer und EÜR; nach der Übernahme der Rechnung zählt ihre Stufe im Mahnwesen. Aufbau der Mahnungen wie
 * in test-fixtures/sevdesk/buchhaltung-1.0/mahnung-mit-rechnung.json (Summen 0, Betrag in reminderTotal, origin).
 */

const TOKEN = "0123456789abcdef0123456789abcdef";
const PDF = (text: string) => new TextEncoder().encode(`%PDF-1.4\n% ${text}\n%%EOF\n`);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const OFFEN = {
  id: "62",
  objectName: "Invoice",
  invoiceNumber: "RE-1042",
  contact: { id: "7", objectName: "Contact" },
  invoiceDate: "2026-09-02T00:00:00+02:00",
  timeToPay: "14",
  status: "200",
  invoiceType: "RE",
  address: "Muster Studio GmbH\nWeg 1",
  currency: "EUR",
  sumNet: "1000.00",
  sumTax: "190.00",
  sumGross: "1190.00",
  paidAmount: 0,
  dunningLevel: "2",
  taxType: "default",
  taxRule: { id: "1", objectName: "TaxRule" },
};

const mahnung = (id: string, level: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  objectName: "Invoice",
  invoiceNumber: `MA-${id}`,
  contact: { id: "7", objectName: "Contact" },
  invoiceDate: `${date}T00:00:00+02:00`,
  status: "500",
  invoiceType: "MA",
  address: "Muster Studio GmbH\nWeg 1",
  currency: "EUR",
  sumNet: "0",
  sumTax: "0",
  sumGross: "0",
  paidAmount: 0,
  dunningLevel: level,
  origin: { id: "62", objectName: "Invoice", invoiceType: null },
  sendDate: `${date}T00:00:00+02:00`,
  reminderTotal: "1190.00",
  reminderDebit: "1190.00",
  reminderCharge: "0",
  reminderDeadline: "2026-10-27T00:00:00+01:00",
  ...extra,
});

function fakeApi(dunnings: unknown[], ohnePdf: string[] = []) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    calls.push(`${path}${url.searchParams.has("invoiceType") ? `?invoiceType=${url.searchParams.get("invoiceType")}` : ""}`);
    if (new Headers(init?.headers).get("authorization") !== TOKEN) return json({ error: { message: "Authentication required" } }, 401);
    const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
    if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "1.0" } });
    if (path === "/Contact") return list([{ id: "7", name: "Muster Studio GmbH", category: { id: "3" } }]);
    // Wie sevDesk: Mahnungen nur mit dem Filter invoiceType=MA
    if (path === "/Invoice") return list(url.searchParams.get("invoiceType") === "MA" ? dunnings : [OFFEN]);
    if (path === "/Invoice/62/getPositions") return list([{ id: 1, taxRate: "19", sumNet: "1000", sumTax: "190" }]);
    const pdf = /^\/Invoice\/(\d+)\/getPdf$/.exec(path);
    if (pdf) {
      if (ohnePdf.includes(pdf[1]!)) return json({ error: { message: "PDF noch nicht erzeugt" } }, 404);
      return json({
        objects: { filename: `${pdf[1]}.pdf`, mimeType: "application/pdf", base64encoded: true, content: Buffer.from(PDF(pdf[1]!)).toString("base64") },
      });
    }
    if (/getXml$/.test(path)) return json({ error: { message: "keine E-Rechnung" } }, 400);
    if (path.startsWith("/") && !path.slice(1).includes("/")) return list([]);
    return json({ error: { message: `unbekannt ${path}` } }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

// Je Test mehrere ganze Abrufe
describe.skipIf(!testDatabaseUrl)("Mahnungen aus sevDesk (Postgres)", { timeout: 30_000 }, () => {
  let sevdesk: typeof import("./sevdesk.ts");
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let dunning: typeof import("../rechnungen/dunning.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    reports = await import("../auswertungen/reports.ts");
    dunning = await import("../rechnungen/dunning.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function abruf(dunnings: unknown[], ohnePdf: string[] = []) {
    const api = fakeApi(dunnings, ohnePdf);
    sevdesk.setSevdeskClientFactory((o) => new importPkg.SevdeskClient({ ...o, fetch: api.fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }));
    await sevdesk.startSevdeskImport(actor, { wait: true });
    return { api, run: (await sevdesk.latestSevdeskImport())! };
  }

  async function reset(versteuerung: string, kontenrahmen: string) {
    await leeren(sql)`truncate legacy_dunning_files, legacy_dunnings, dunnings, journal_lines, journal_entries, document_amounts, documents,
      invoice_lines, invoices, legacy_voucher_payments, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, sevdesk_connection,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    sevdesk.setSevdeskClientFactory((o) => new importPkg.SevdeskClient({ ...o, fetch: fakeApi([]).fetchFn, minIntervalMs: 0, maxRetries: 0 }));
    await sevdesk.saveSevdeskKey(actor, TOKEN);
  }

  /** Alles, was Umsatz, Steuer und offene Posten aus dem Altbestand liest */
  async function stand() {
    const { years } = await lexoffice.reconciliation();
    return {
      years,
      open: await legacy.openLegacyItems(),
      euer: await reports.euerForYear(2026),
      periode: await lexoffice.legacyVouchersForPeriod({ period: "2026", direction: "alle", search: "", withPayments: true, limit: 1000 }),
      belege: (await sql`select count(*)::int as n from lexoffice_vouchers`)[0]!.n,
    };
  }

  for (const kontenrahmen of ["SKR03", "SKR04"]) {
    for (const versteuerung of ["ist", "soll"]) {
      it(`archiviert die Stufen mit PDF und lässt Abgleich, offene Posten, Umsatzsteuer und EÜR unverändert (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await abruf([]);
        const ohne = await stand();
        expect(ohne.open.map((i) => [i.number, i.open])).toEqual([["RE-1042", 119_000]]);

        const { api, run } = await abruf([mahnung("63", "1", "2026-10-01"), mahnung("64", "2", "2026-10-20")]);
        expect(run.status).toBe("fertig");
        expect(run.progress).toMatchObject({ dunnings: 2, failed: [] });
        expect(api.calls).toContain("/Invoice?invoiceType=MA");
        expect(await stand()).toEqual(ohne);

        const rows = await sql`select external_id, invoice_external_id, level, date, due_date, total, status, contact_id is not null as kontakt
          from legacy_dunnings order by level`;
        expect(rows.map((r) => ({ ...r }))).toEqual([
          {
            external_id: "invoice/63",
            invoice_external_id: "invoice/62",
            level: 1,
            date: "2026-10-01",
            due_date: "2026-10-27",
            total: 119_000,
            status: "500",
            kontakt: true,
          },
          {
            external_id: "invoice/64",
            invoice_external_id: "invoice/62",
            level: 2,
            date: "2026-10-20",
            due_date: "2026-10-27",
            total: 119_000,
            status: "500",
            kontakt: true,
          },
        ]);
        const [rechnung] = await sql`select id from lexoffice_vouchers where lexoffice_id = 'invoice/62'`;
        const detail = await lexoffice.legacyVoucherDetail(rechnung!.id);
        expect(detail!.dunnings.map((d) => [d.level, d.files.map((f) => f.filename)])).toEqual([
          [1, ["63.pdf"]],
          [2, ["64.pdf"]],
        ]);
      });
    }
  }

  it("holt bei einem weiteren Abruf nichts doppelt", async () => {
    const { api, run } = await abruf([mahnung("63", "1", "2026-10-01"), mahnung("64", "2", "2026-10-20")]);
    expect(run.progress.dunnings ?? 0).toBe(0);
    expect(api.calls.filter((c) => c.endsWith("/getPdf"))).toEqual([]);
    expect((await sql`select count(*)::int as n from legacy_dunning_files`)[0]!.n).toBe(2);
  });

  it("lässt Entwürfe aus und hält den Abruf bei einem Fehler nicht an", async () => {
    await reset("ist", "SKR03");
    const { run } = await abruf([mahnung("65", "1", "2026-10-01", { status: "100" }), mahnung("66", "1", "2026-10-01", { invoiceDate: null, create: null })]);
    expect(run.status).toBe("fertig");
    // Wie bei Rechnungen ohne Datum: Der Grund steht im Server-Log
    expect(run.progress.failed).toEqual([expect.objectContaining({ lexofficeId: "invoice/66", number: "MA-66" })]);
    expect((await sql`select count(*)::int as n from legacy_dunnings`)[0]!.n).toBe(0);
    expect((await sql`select count(*)::int as n from lexoffice_vouchers`)[0]!.n).toBe(1);
  });

  it("archivierte Mahnungen lassen sich nicht ändern", async () => {
    await abruf([mahnung("67", "1", "2026-10-01")]);
    await expect(sql`update legacy_dunnings set level = 2`).rejects.toThrow();
    await expect(sql`delete from legacy_dunning_files`).rejects.toThrow();
  });

  for (const versteuerung of ["ist", "soll"]) {
    it(`übernimmt die Stufe ins Mahnwesen: nach Stufe 2 aus sevDesk folgt die letzte Mahnung (${versteuerung})`, async () => {
      await reset(versteuerung, "SKR04");
      await abruf([mahnung("63", "1", "2026-10-01"), mahnung("64", "2", "2026-10-20")]);
      const [item] = await legacy.openLegacyItems();
      const { id } = await legacy.takeOverLegacyItem(actor, item!.id);
      const today = "2026-11-15";

      const [overdue] = await dunning.overdueInvoices(today);
      expect(overdue).toMatchObject({ id, nextLevel: 3, waiting: false, lastDunning: null, importedDunning: { level: 2, sourceLevel: 2, date: "2026-10-20" } });
      expect(overdue!.importedDunning!.fileId).toEqual(expect.any(String));
      expect((await dunning.dunningDraft(id, today))!.level).toBe(3);

      const input = { invoiceId: id, level: 2 as const, dueDate: "2026-11-29", fee: 0, flatFee: false, interest: null, intro: "Bitte zahlen.", closing: "" };
      await expect(dunning.createDunning(actor, input, today)).rejects.toThrow(
        /schon mit „1\. Mahnung“ gemahnt \(in sevDesk\)\. Als Nächstes folgt „Letzte Mahnung“/,
      );
      expect((await dunning.createDunning(actor, { ...input, level: 3 }, today)).level).toBe(3);
      const [after] = await dunning.overdueInvoices(today);
      expect(after).toMatchObject({ nextLevel: 3, waiting: true, importedDunning: null, lastDunning: { level: 3 } });
    });
  }

  it("Stufe 1 aus sevDesk ist die Zahlungserinnerung; eine höhere Stufe zählt wie Stufe 2", async () => {
    await reset("ist", "SKR03");
    await abruf([mahnung("63", "1", "2026-10-01")]);
    const [item] = await legacy.openLegacyItems();
    const { id } = await legacy.takeOverLegacyItem(actor, item!.id);
    expect((await dunning.dunningDraft(id, "2026-11-15"))!.level).toBe(2);

    await abruf([mahnung("68", "4", "2026-11-01")]);
    const [overdue] = await dunning.overdueInvoices("2026-11-15");
    expect(overdue).toMatchObject({ nextLevel: 3, importedDunning: { level: 2, sourceLevel: 4 } });
  });
  it("nimmt die archivierten Mahnungen mit PDF und Quelldaten in den Jahresexport auf", async () => {
    await reset("ist", "SKR03");
    await abruf([mahnung("63", "1", "2026-10-01"), mahnung("64", "2", "2026-10-20")]);
    const exporter = await import("./export.ts");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2026)) chunks.push(chunk);
    const files = unzipSync(Buffer.concat(chunks));
    const inhalt = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
    // Mahnungen sind Handelsbriefe (§ 147 Abs. 1 Nr. 2 und 3 AO): beide PDFs und ihre Angaben gehören ins Archiv des Jahres
    for (const id of ["63", "64"]) {
      expect(Object.values(files).some((bytes) => inhalt(bytes) === inhalt(PDF(id)))).toBe(true);
      expect(Object.entries(files).some(([path, bytes]) => !path.endsWith(".pdf") && inhalt(bytes).includes(`MA-${id}`))).toBe(true);
    }
    // Ohne Buchungswirkung: kein Archivbeleg für die Mahnungen
    expect(inhalt(files["lexoffice/belege.csv"] ?? new Uint8Array())).not.toContain("MA-6");
  });
  it("lädt ein beim ersten Abruf fehlendes PDF beim nächsten Abruf nach, ohne die Mahnung zu ändern", async () => {
    await reset("ist", "SKR03");
    const stufe = mahnung("63", "1", "2026-10-01");
    const erster = await abruf([stufe], ["63"]);
    expect(erster.run.progress.dunnings).toBe(1);
    const vorher = await sql`select * from legacy_dunnings`;
    expect((await sql`select count(*)::int as n from legacy_dunning_files`)[0]!.n).toBe(0);

    const { api } = await abruf([stufe]);
    expect(api.calls.filter((c) => c === "/Invoice/63/getPdf")).toHaveLength(1);
    expect((await sql`select filename from legacy_dunning_files`).map((r) => r.filename)).toEqual(["63.pdf"]);
    expect(await sql`select * from legacy_dunnings`).toEqual(vorher);

    // Liegt das PDF vor, ruft ein weiterer Abruf es nicht noch einmal ab
    const dritter = await abruf([stufe]);
    expect(dritter.api.calls.filter((c) => c.endsWith("/getPdf") && c.includes("63"))).toEqual([]);
  });
});
