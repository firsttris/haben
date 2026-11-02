import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { mapContact, mapPayments, mapSalesDocument, mapVoucher } from "../map.ts";
import { itemTax, webBookkeepingVoucher, webContact, webPayments, webSalesDocument, webStatus } from "./convert.ts";
import { webEntrySchema, type WebEntry } from "./schema.ts";
import { LexwareWebExportError, readWebExport, webExportSource } from "./source.ts";

const raw = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../test-fixtures/lexoffice-web/${name}`, import.meta.url), "utf8"));
const entry = (name: string): WebEntry => webEntrySchema.parse({ files: [], ...(raw(name) as object) });

const SALES = entry("sales-invoice.json");
const PURCHASE = entry("purchase-gross.json");
const CREDIT_NOTE = entry("purchase-creditnote-net.json");
const CONTACTS = raw("contacts.json") as Parameters<typeof webContact>[0][];

describe("Umrechnung der Web-Oberfläche in die Form der Public API", () => {
  it("Rechnung: Beträge, Steuer je Satz, Leistungszeitraum und Anschrift", () => {
    const voucher = mapSalesDocument("invoice", webSalesDocument(SALES), SALES.list.entityId);
    expect(voucher).toMatchObject({
      type: "invoice",
      direction: "einnahme",
      number: "RE0042",
      date: "2025-11-03",
      dueDate: "2025-12-03",
      serviceFrom: "2025-10-01",
      serviceTo: "2025-10-31",
      status: "paid",
      contactLexofficeId: "c0000000-0000-4000-8000-000000000001",
      contactName: "Musterbau GmbH",
      net: 52500,
      tax: 9975,
      gross: 62475,
      taxes: [{ rate: 1900, net: 52500, tax: 9975 }],
      remark: "Vielen Dank für die gute Zusammenarbeit.",
    });
    const converted = webSalesDocument(SALES);
    expect(converted.taxConditions?.taxType).toBe("net");
    expect(converted.address).toMatchObject({ street: "Hauptstr. 1", zip: "10115", city: "Berlin", countryCode: "DE" });
  });

  it("Schlussrechnung: zählt den geforderten Betrag, die Abschläge zieht mapSalesDocument nicht noch einmal ab", () => {
    const closing = structuredClone(SALES);
    Object.assign(closing.document!.voucher, {
      claimedGrossAmount: 119,
      claimedNetAmount: 100,
      claimedTaxAmounts: [{ percent: 19, taxAmount: 19, amount: 119 }],
    });
    const voucher = mapSalesDocument("invoice", webSalesDocument(closing), closing.list.entityId);
    expect(voucher).toMatchObject({ net: 10000, tax: 1900, gross: 11900, taxes: [{ rate: 1900, net: 10000, tax: 1900 }] });
  });

  it("Ausgabe mit Bruttobeträgen: Steuer je Position herausgerechnet, Kategorien und Status", () => {
    const voucher = mapVoucher(webBookkeepingVoucher(PURCHASE), PURCHASE.list.entityId);
    expect(voucher).toMatchObject({
      type: "purchaseinvoice",
      direction: "ausgabe",
      number: "2025-4711",
      date: "2025-10-11",
      dueDate: "2025-10-25",
      status: "overdue",
      contactLexofficeId: "c0000000-0000-4000-8000-000000000002",
      gross: 13090,
      // 119,00 zu 19 %: 19,00; 11,90 zu 7 %: 0,7785 → 0,78
      tax: 1978,
      net: 11112,
      categories: [
        { categoryId: "cat-buero", net: 10000, tax: 1900, rate: 1900 },
        { categoryId: "cat-lit", net: 1112, tax: 78, rate: 700 },
      ],
      remark: "Bürobedarf und Buch",
    });
  });

  it("Ausgabenminderung mit Nettobeträgen: Steuer aufgeschlagen, Beträge negativ, ohne Kontakt", () => {
    const voucher = mapVoucher(webBookkeepingVoucher(CREDIT_NOTE), CREDIT_NOTE.list.entityId);
    expect(voucher).toMatchObject({
      type: "purchasecreditnote",
      gross: -5950,
      tax: -950,
      net: -5000,
      status: "paidoff",
      contactLexofficeId: null,
      contactName: "Bürohandel Nord",
    });
  });

  it("Steuer je Position: brutto herausgerechnet, netto aufgeschlagen, kaufmännisch gerundet, Vorzeichen bleibt", () => {
    expect(itemTax(11900, 19, true)).toBe(1900);
    expect(itemTax(1190, 7, true)).toBe(78);
    expect(itemTax(-1190, 7, true)).toBe(-78);
    expect(itemTax(5000, 19, false)).toBe(950);
    expect(itemTax(1000, 5.5, false)).toBe(55);
    expect(itemTax(1000, 0, true)).toBe(0);
  });

  it("Zahlungen: Stand-Zeilen fallen weg, „Sonstige Zahlung“ wird manualPayment, bezahlt am letzten Zahlungstag", () => {
    expect(mapPayments(webPayments(SALES))).toEqual({
      status: "balanced",
      openAmount: 0,
      paidDate: "2025-12-01",
      items: [
        { type: "partPaymentFinancialTransaction", date: "2025-11-20", amount: 60000 },
        { type: "manualPayment", date: "2025-12-01", amount: 2475 },
      ],
    });
    expect(mapPayments(webPayments(PURCHASE))).toEqual({ status: "openExpense", openAmount: -13090, paidDate: null, items: [] });
  });

  it("Status: sepa_debit heißt in der Public API sepadebit", () => {
    expect(webStatus("sepa_debit")).toBe("sepadebit");
    expect(webStatus("paid")).toBe("paid");
    expect(webStatus(undefined)).toBe("");
  });

  it("Kontakte: Firma und Person, Rollen, Adresszusatz, E-Mail und Archiv", () => {
    expect(mapContact(webContact(CONTACTS[0]!))).toMatchObject({
      name: "Musterbau GmbH",
      kundennummer: "10001",
      lieferantennummer: null,
      strasse: "Hauptstr. 1 (Hinterhaus)",
      plz: "10115",
      ort: "Berlin",
      email: "rechnung@musterbau.example",
      ustId: "DE123456789",
      isCustomer: true,
      isVendor: false,
      archived: false,
    });
    expect(mapContact(webContact(CONTACTS[1]!))).toMatchObject({
      name: "Erika Beispiel",
      kundennummer: null,
      lieferantennummer: "70001",
      email: "erika@beispiel.example",
      isCustomer: false,
      isVendor: true,
      archived: true,
    });
  });
});

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

function part(options: { manifest?: object; entries?: Record<string, unknown>; files?: Record<string, Uint8Array> } = {}) {
  return zipSync({
    "manifest.json": encode({ format: "haben-lexware-web", version: 1, part: 1, createdAt: "2026-11-02T10:00:00.000Z", ...options.manifest }),
    "kontakte.json": encode(CONTACTS),
    ...Object.fromEntries(Object.entries(options.entries ?? {}).map(([id, value]) => [`belege/${id}.json`, encode(value)])),
    ...options.files,
  });
}

describe("Sicherung lesen", () => {
  const salesWithPdf = { ...(raw("sales-invoice.json") as object), files: [{ path: `dateien/${SALES.list.entityId}/1-RE0042.pdf`, role: "pdf", mimeType: "application/pdf", filename: "Rechnung_RE0042.pdf" }] };
  const purchaseWithFiles = {
    ...(raw("purchase-gross.json") as object),
    files: [
      { path: `dateien/${PURCHASE.list.entityId}/1-2025-4711.pdf`, role: "anhang", mimeType: "application/pdf", filename: "2025-4711.pdf" },
      { path: `dateien/${PURCHASE.list.entityId}/2-e.xml`, role: "xml", mimeType: "application/xml", filename: null },
    ],
  };

  it("liefert Kontakte, Belege, Dateien und Zahlungen über dieselbe Schnittstelle wie die API", async () => {
    const data = readWebExport([
      {
        name: "teil-01.zip",
        bytes: part({
          entries: { [SALES.list.entityId]: salesWithPdf, [PURCHASE.list.entityId]: purchaseWithFiles },
          files: {
            [`dateien/${SALES.list.entityId}/1-RE0042.pdf`]: PDF,
            [`dateien/${PURCHASE.list.entityId}/1-2025-4711.pdf`]: PDF,
            [`dateien/${PURCHASE.list.entityId}/2-e.xml`]: encode("<xml/>"),
          },
        }),
      },
    ]);
    const source = webExportSource(data);
    const contacts = [];
    for await (const c of source.contacts()) contacts.push(c.id);
    expect(contacts).toHaveLength(2);

    const list = [];
    for await (const item of source.voucherList(["invoice", "purchaseinvoice"])) list.push([item.voucherType, item.voucherNumber]);
    expect(list).toEqual([
      ["invoice", "RE0042"],
      ["purchaseinvoice", "2025-4711"],
    ]);

    const pdf = await source.salesDocumentPdf("invoice", SALES.list.entityId);
    expect(pdf).toMatchObject({ mimeType: "application/pdf", filename: "Rechnung_RE0042.pdf" });
    expect(await source.salesDocumentXml("invoice", SALES.list.entityId)).toBeNull();

    const voucher = await source.voucher(PURCHASE.list.entityId);
    expect(voucher.files).toEqual([`dateien/${PURCHASE.list.entityId}/1-2025-4711.pdf`, `dateien/${PURCHASE.list.entityId}/2-e.xml`]);
    expect(voucher).toMatchObject({ quelle: "lexware-web" });
    expect((await source.file(voucher.files![1]!)).mimeType).toBe("application/xml");
    expect((await source.payments(SALES.list.entityId))?.paymentStatus).toBe("balanced");
    expect((await source.postingCategories()).map((c) => c.name).sort()).toEqual(["Bürobedarf", "Fachliteratur"]);
  });

  it("meldet Belege, die das Skript nicht laden konnte oder deren JSON nicht passt, als fehlgeschlagen", async () => {
    const data = readWebExport([
      {
        name: "teil-01.zip",
        bytes: part({
          manifest: { failed: [{ id: "x-1", type: "Invoice", number: "RE0007", message: "HTTP 500 bei /papyrus-rest/…" }] },
          entries: { "x-2": { list: { kaputt: true } } },
        }),
      },
    ]);
    const source = webExportSource(data);
    const list = [];
    for await (const item of source.voucherList(["invoice", "purchaseinvoice"])) list.push([item.id, item.voucherType, item.voucherNumber]);
    expect(list).toEqual([
      ["x-1", "invoice", "RE0007"],
      ["x-2", "purchaseinvoice", ""],
    ]);
    await expect(source.salesDocument("invoice", "x-1")).rejects.toThrow("In Lexware Office nicht geladen: HTTP 500 bei /papyrus-rest/…");
    await expect(source.voucher("x-2")).rejects.toThrow(/unerwartetes Format/);
  });

  it("ein späterer Teil mit dem Beleg ersetzt den Fehler aus einem früheren", () => {
    const data = readWebExport([
      { name: "a.zip", bytes: part({ manifest: { failed: [{ id: SALES.list.entityId, type: "Invoice", number: "RE0042", message: "Zeitüberschreitung" }] } }) },
      { name: "b.zip", bytes: part({ entries: { [SALES.list.entityId]: { ...(raw("sales-invoice.json") as object), files: [] } } }) },
    ]);
    expect(data.failures.size).toBe(0);
    expect(data.entries.has(SALES.list.entityId)).toBe(true);
  });

  it("ein späterer Teil, der einen schon gelesenen Beleg als fehlgeschlagen meldet, listet ihn nicht doppelt", async () => {
    const data = readWebExport([
      { name: "a.zip", bytes: part({ entries: { [SALES.list.entityId]: { ...(raw("sales-invoice.json") as object), files: [] } } }) },
      { name: "b.zip", bytes: part({ manifest: { failed: [{ id: SALES.list.entityId, type: "Invoice", number: "RE0042", message: "Zeitüberschreitung" }] } }) },
    ]);
    const list = [];
    for await (const item of webExportSource(data).voucherList(["invoice"])) list.push(item.id);
    expect(list).toEqual([SALES.list.entityId]);
    expect(data.failures.size).toBe(0);
  });

  it("lehnt fremde Dateien mit verständlicher Meldung ab", () => {
    const read = (bytes: Uint8Array) => () => readWebExport([{ name: "x.zip", bytes }]);
    expect(read(new TextEncoder().encode("kein zip"))).toThrow(new LexwareWebExportError("x.zip: keine gültige ZIP-Datei."));
    expect(read(zipSync({ "a.txt": encode("x") }))).toThrow(/manifest.json fehlt/);
    expect(read(part({ manifest: { format: "etwas-anderes" } }))).toThrow(/keine Sicherung aus dem Skript/);
    expect(read(part({ manifest: { version: 2 } }))).toThrow(/Version 2; diese Version von Haben liest bis Version 1/);
  });
});
