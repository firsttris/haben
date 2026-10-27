import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const PDF = new TextEncoder().encode("%PDF-1.4\n% Rechnung RE-1001\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const INVOICES = [
  {
    id: "101",
    objectName: "Invoice",
    invoiceNumber: "RE-1001",
    contact: { id: "7", objectName: "Contact" },
    invoiceDate: "2024-03-05T00:00:00+01:00",
    timeToPay: "14",
    status: "1000",
    invoiceType: "RE",
    address: "Berliner Kindl GmbH\nHauptstr. 1",
    currency: "EUR",
    sumNet: "100.00",
    sumTax: "19.00",
    sumGross: "119.00",
    paidAmount: 119,
    payDate: "2024-03-20T00:00:00+01:00",
    taxType: "default",
    taxRule: { id: "1", objectName: "TaxRule" },
  },
  {
    id: "102",
    objectName: "Invoice",
    invoiceNumber: "RE-1002",
    contact: { id: "8", objectName: "Contact" },
    invoiceDate: "2024-04-02T00:00:00+02:00",
    timeToPay: "30",
    status: "200",
    invoiceType: "RE",
    address: "Erika Mustermann",
    currency: "EUR",
    sumNet: "200.00",
    sumTax: "14.00",
    sumGross: "214.00",
    paidAmount: 0,
  },
  // Entwurf: bleibt draußen
  { id: "103", invoiceNumber: "", invoiceDate: "2024-04-03", status: "100", invoiceType: "RE", sumNet: "1", sumTax: "0", sumGross: "1" },
];

const VOUCHERS = [
  {
    id: "301",
    objectName: "Voucher",
    voucherDate: "2024-02-10T00:00:00+01:00",
    supplier: { id: "12", objectName: "Contact" },
    supplierName: "Bürohaus GmbH",
    description: "B-2024-17",
    document: { id: "880", objectName: "Document" },
    status: "100",
    sumNet: "100.00",
    sumTax: "19.00",
    sumGross: "119.00",
    paidAmount: 0,
    creditDebit: "D",
    voucherType: "VOU",
    currency: "EUR",
    paymentDeadline: "2024-02-24T00:00:00+01:00",
  },
  { id: "302", voucherDate: "2024-02-11", status: "50", creditDebit: "D", voucherType: "VOU", sumGross: "5", sumTax: "0" },
];

/** Nachgebaute sevDesk-API */
function fakeApi(options: { failVoucher?: boolean } = {}) {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    calls.push(path);
    if (new Headers(init?.headers).get("authorization") !== TOKEN) return json({ error: { message: "Authentication required" } }, 401);
    const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
    switch (path) {
      case "/Tools/bookkeepingSystemVersion":
        return json({ objects: { version: "2.0" } });
      case "/Contact":
        return list([
          { id: "7", name: "Berliner Kindl GmbH", customerNumber: "1001" },
          { id: "8", surename: "Erika", familyname: "Mustermann", customerNumber: "1002" },
          { id: "9", surename: "Ansprech", familyname: "Partner", parent: { id: "7", objectName: "Contact" } },
          { id: "12", name: "Bürohaus GmbH" },
        ]);
      case "/ContactAddress":
        return list([{ id: 1, contact: { id: "8", objectName: "Contact" }, street: "Weg 2", zip: "50667", city: "Köln", country: { id: 1, code: "de" } }]);
      case "/CommunicationWay":
        return list([{ id: 1, contact: { id: "8" }, type: "EMAIL", value: "erika@example.com", main: true }]);
      case "/Invoice":
        return list(INVOICES);
      case "/CreditNote":
        return list([]);
      case "/Voucher":
        return list(VOUCHERS);
      case "/Invoice/101/getPositions":
        return list([{ id: 1, taxRate: "19", sumNet: "100", sumTax: "19" }]);
      case "/Invoice/102/getPositions":
        return list([{ id: 2, taxRate: "7", sumNet: "200", sumTax: "14" }]);
      case "/VoucherPos":
        return options.failVoucher ? json({ error: { message: "kaputt" } }, 500) : list([{ id: 3, accountDatev: { id: 4930 }, taxRate: "19", sumNet: "100", sumTax: "19" }]);
      case "/Document/880/download":
        return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    }
    if (/^\/Invoice\/\d+\/getPdf$/.test(path)) {
      return json({ objects: { filename: `${path.split("/")[2]}.pdf`, mimeType: "application/pdf", base64encoded: true, content: Buffer.from(PDF).toString("base64") } });
    }
    if (/^\/Invoice\/\d+\/getXml$/.test(path)) return json({ error: { message: "keine E-Rechnung" } }, 400);
    return json({ error: { message: `unbekannt ${path}` } }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe.skipIf(!testDatabaseUrl)("sevDesk-Übernahme (Postgres)", () => {
  let sevdesk: typeof import("./sevdesk.ts");
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let importPkg: typeof import("@haben/import");
  let sql: postgres.Sql;
  const actor = "test-user";

  function useApi(options: { failVoucher?: boolean } = {}) {
    const api = fakeApi(options);
    sevdesk.setSevdeskClientFactory(
      (o) => new importPkg.SevdeskClient({ ...o, fetch: api.fetchFn, minIntervalMs: 0, maxRetries: 0, sleep: async () => {} }),
    );
    return api;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("lehnt einen falschen Token ab und speichert den richtigen verschlüsselt", async () => {
    useApi();
    await expect(sevdesk.saveSevdeskKey(actor, "falsch-falsch-falsch-falsch")).rejects.toThrow(/lehnt den Token ab: API-Token ungültig/);
    expect(await sevdesk.saveSevdeskKey(actor, TOKEN)).toEqual({ bookkeepingVersion: "2.0" });
    const [row] = await sql`select ciphertext from sevdesk_connection`;
    expect(Buffer.from(row!.ciphertext as Uint8Array).includes(Buffer.from(TOKEN))).toBe(false);
    expect((await sevdesk.sevdeskConnectionStatus())?.bookkeepingVersion).toBe("2.0");
  });

  it("übernimmt Kontakte, Rechnungen und Belege mit Dateien; ein Fehler hält den Lauf nicht auf", async () => {
    await sql`insert into contacts (name) values ('Berliner Kindl GmbH')`;
    useApi({ failVoucher: true });
    const id = await sevdesk.startSevdeskImport(actor, { wait: true });
    const run = await sevdesk.latestSevdeskImport();
    expect(run).toMatchObject({ id, status: "fertig", source: "sevdesk" });
    expect(run!.progress).toMatchObject({ contacts: 2, contactsLinked: 1, listed: 3, imported: 2, files: 2 });
    expect(run!.progress.failed).toEqual([expect.objectContaining({ lexofficeId: "voucher/301", number: "B-2024-17", message: expect.stringContaining("500") })]);
    // Der Lexoffice-Abruf sieht den sevDesk-Lauf nicht
    expect(await lexoffice.latestImport()).toBeNull();

    const contacts = await sql`select name, sevdesk_id, email, ort from contacts order by name`;
    expect(contacts.map((c) => [c.name, c.sevdesk_id])).toEqual([
      ["Berliner Kindl GmbH", "7"],
      ["Bürohaus GmbH", "12"],
      ["Erika Mustermann", "8"],
    ]);
    expect(contacts[2]).toMatchObject({ email: "erika@example.com", ort: "Köln" });

    const vouchers = await sql`select lexoffice_id, source, number, type, gross, taxes, payment, contact_id from lexoffice_vouchers order by number`;
    expect(vouchers.map((v) => [v.lexoffice_id, v.source, v.number, v.type, v.gross])).toEqual([
      ["invoice/101", "sevdesk", "RE-1001", "invoice", 11900],
      ["invoice/102", "sevdesk", "RE-1002", "invoice", 21400],
    ]);
    expect(vouchers.every((v) => v.contact_id)).toBe(true);
    expect(vouchers[1]!.taxes).toEqual([{ rate: 700, net: 20000, tax: 1400 }]);
    expect(vouchers[0]!.payment).toMatchObject({ openAmount: 0, items: [{ date: "2024-03-20", amount: 11900 }] });
    const [file] = await sql`select filename, mime_type, role from lexoffice_voucher_files f join lexoffice_vouchers v on v.id = f.voucher_id where v.number = 'RE-1001'`;
    expect(file).toMatchObject({ filename: "101.pdf", mime_type: "application/pdf", role: "pdf" });
  });

  it("setzt beim nächsten Abruf fort und holt die Datei des Belegs", async () => {
    const api = useApi();
    await sevdesk.startSevdeskImport(actor, { wait: true });
    const run = await sevdesk.latestSevdeskImport();
    expect(run!.progress).toMatchObject({ imported: 1, skipped: 2, contacts: 0, failed: [] });
    expect(api.calls.filter((c) => c.startsWith("/Invoice/"))).toEqual([]);
    const [voucher] = await sql`select direction, type, categories, payment from lexoffice_vouchers where lexoffice_id = 'voucher/301'`;
    expect(voucher).toMatchObject({ direction: "ausgabe", type: "purchaseinvoice", payment: { openAmount: 11900 } });
    expect(voucher!.categories[0]).toMatchObject({ categoryId: "4930", rate: 1900 });
    const [attachment] = await sql`select filename, mime_type, lexoffice_file_id from lexoffice_voucher_files where role = 'anhang'`;
    expect(attachment).toMatchObject({ filename: "B-2024-17.jpg", mime_type: "image/jpeg", lexoffice_file_id: "880" });
  });

  it("zählt reguläre sevDesk-Rechnungen im Abgleich unter Kz 81 und Kz 86", async () => {
    const { years } = await lexoffice.reconciliation();
    const year = years.find((y) => y.year === 2024)!;
    // Ist: RE-1001 bezahlt im März; RE-1002 (7 %) ist noch offen
    expect(year.vat.find((m) => m.month === "2024-03")).toMatchObject({ kz81: 10_000, tax81: 1_900, otherBase: 0 });
    expect(year.taxTypes).toEqual([{ taxType: "net", count: 2 }]);
  });

  it("bietet offene Rechnungen und Belege zur Übernahme an", async () => {
    const items = await legacy.openLegacyItems();
    expect(items.map((i) => [i.number, i.open, i.blocker])).toEqual([
      ["B-2024-17", 11900, null],
      ["RE-1002", 21400, null],
    ]);
  });
});
