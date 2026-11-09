import { describe, expect, it } from "vitest";
import belegeOhneDatei from "../../test-fixtures/sevdesk/buchhaltung-1.0/beleg-ohne-datei.json" with { type: "json" };
import belegeRv from "../../test-fixtures/sevdesk/buchhaltung-1.0/beleg-wiederkehrend-rv.json" with { type: "json" };
import belege from "../../test-fixtures/sevdesk/buchhaltung-1.0/belege-credit-debit.json" with { type: "json" };
import dateiDownload from "../../test-fixtures/sevdesk/buchhaltung-1.0/document-download.json" with { type: "json" };
import vorlagenWkr from "../../test-fixtures/sevdesk/buchhaltung-1.0/rechnungsvorlage-wkr.json" with { type: "json" };
import stornoV1 from "../../test-fixtures/sevdesk/buchhaltung-1.0/storno-paar.json" with { type: "json" };
import belegeV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/belege-credit-debit.json" with { type: "json" };
import gutschriftV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/gutschrift.json" with { type: "json" };
import stornoFolgejahrV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/storno-paar-folgejahr.json" with { type: "json" };
import stornoV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/storno-paar.json" with { type: "json" };
import zahlungenV2 from "../../test-fixtures/sevdesk/buchhaltung-2.0/zahlungen.json" with { type: "json" };
import {
  isSevCreditNoteImportable,
  isSevInvoiceImportable,
  isSevVoucherImportable,
  mapSevCreditNote,
  mapSevInvoice,
  mapSevPaymentLogs,
  mapSevVoucher,
} from "./map.ts";
import { sevCheckAccountTransactionLogSchema, sevCreditNoteSchema, sevFileResponseSchema, sevInvoiceSchema, sevVoucherSchema } from "./types.ts";

/* Anonymisierte echte Antworten je Buchhaltungsversion; weicht eine Version ab, fällt es hier auf (#472). */

describe.each([
  ["1.0", stornoV1],
  ["2.0", stornoV2],
  ["2.0, Storno in einem späteren Jahr", stornoFolgejahrV2],
])("Stornorechnung in Buchhaltungsversion %s", (_version, paar) => {
  const original = mapSevInvoice(sevInvoiceSchema.parse(paar.original_storniert.invoice), []);
  const storno = mapSevInvoice(sevInvoiceSchema.parse(paar.stornorechnung.invoice), []);

  it("führt die Rechnung und ihr Storno als gegengleiche Beträge", () => {
    expect(original.voucher.type).toBe("invoice");
    expect(original.voucher.gross).toBeGreaterThan(0);
    expect(storno.voucher).toMatchObject({ type: "creditnote", direction: "einnahme", gross: -original.voucher.gross });
  });

  it("verweist mit origin vom Storno auf die Rechnung", () => {
    const { origin } = paar.stornorechnung.invoice as { origin: { id: string; objectName: string } };
    expect(origin).toMatchObject({ id: paar.original_storniert.invoice.id, objectName: "Invoice" });
  });

  it("nennt beide bezahlt, obwohl keine Zahlung floss", () => {
    for (const { invoice } of [paar.original_storniert, paar.stornorechnung]) {
      expect(invoice.status).toBe("1000");
      expect(Number(invoice.paidAmount)).toBe(0);
      expect(invoice.payDate).toBeNull();
    }
  });
});

describe("Belegrichtung in Buchhaltungsversion 1.0", () => {
  it.each(belege.map((b) => [b.positions[0]!.accountingType.name, b] as const))("%s", (_konto, beleg) => {
    const { voucher } = mapSevVoucher(sevVoucherSchema.parse(beleg.voucher), beleg.positions);
    expect(voucher.direction).toBe(beleg.voucher.creditDebit === "C" ? "ausgabe" : "einnahme");
  });

  it("trägt bei D Erlöse und bei C Aufwand", () => {
    const konten = (seite: string) => belege.filter((b) => b.voucher.creditDebit === seite).map((b) => b.positions[0]!.accountingType.name);
    expect(konten("D")).toContain("Einnahmen / Erlöse / Verkäufe");
    expect(konten("C")).toContain("Benzin");
  });
});

describe("Belegrichtung in Buchhaltungsversion 2.0", () => {
  type Position = { accountDatev?: { name: string }; accountingType?: { name: string } };
  const konto = (b: { positions: unknown[] }) => {
    const p = b.positions[0] as Position;
    return (p.accountDatev ?? p.accountingType)!.name;
  };
  const konten = (seite: string) => belegeV2.filter((b) => b.voucher.creditDebit === seite).map(konto);

  it.each(belegeV2.map((b) => [konto(b), b] as const))("%s", (_konto, beleg) => {
    const { voucher } = mapSevVoucher(sevVoucherSchema.parse(beleg.voucher), beleg.positions as never[]);
    expect(voucher.direction).toBe(beleg.voucher.creditDebit === "C" ? "ausgabe" : "einnahme");
  });

  it("trägt bei C Aufwand und bei D Erträge", () => {
    expect(konten("C")).toEqual(expect.arrayContaining(["Wareneingang", "Wareneinkauf", "Umsatzsteuer-Vorauszahlungen"]));
    expect(konten("D")).toContain("Sonstige Zinsen und ähnliche Erträge");
  });

  it("kennt bei D auch ein Aufwandskonto, das Vorzeichen des Belegs bleibt positiv", () => {
    // Vermutlich Erstattungen; die Beträge sind maskiert, das lässt sich an diesen Daten nicht prüfen.
    const erstattungen = belegeV2.filter((b) => b.voucher.creditDebit === "D" && konto(b) === "KFZ-Versicherung");
    expect(erstattungen).toHaveLength(2);
    for (const b of erstattungen) expect(Number(b.voucher.sumGross)).toBeGreaterThan(0);
  });

  it("führt die Datei nur bei Belegen mit document", () => {
    const fileIds = belegeV2.map((b) => mapSevVoucher(sevVoucherSchema.parse(b.voucher), b.positions as never[]).voucher.fileIds);
    expect(fileIds.filter((ids) => ids.length === 0)).toHaveLength(1);
    expect(fileIds.filter((ids) => ids.length === 1)).toHaveLength(belegeV2.length - 1);
  });
});

describe("Stornorechnung in einem späteren Jahr, Buchhaltungsversion 2.0", () => {
  it("bucht das Storno auf sein eigenes Datum, nicht auf das der Rechnung", () => {
    const { original_storniert: original, stornorechnung: storno } = stornoFolgejahrV2;
    const datum = (teil: { invoice: unknown }) => mapSevInvoice(sevInvoiceSchema.parse(teil.invoice), []).voucher.date.slice(0, 4);
    expect(Number(datum(storno))).toBeGreaterThan(Number(datum(original)));
  });
});

describe("Gutschrift (CreditNote) in Buchhaltungsversion 2.0", () => {
  const gutschrift = sevCreditNoteSchema.parse(gutschriftV2.objects[0]);

  it("führt die positiv gelieferte Gutschrift als negative Einnahme", () => {
    expect(gutschrift.sumGross).toBe("100.00");
    expect(isSevCreditNoteImportable(gutschrift)).toBe(true);
    expect(mapSevCreditNote(gutschrift, []).voucher).toMatchObject({ type: "creditnote", direction: "einnahme", status: "paid", gross: -10000 });
  });

  it("nimmt bei maskiertem creditNoteDate das Anlagedatum", () => {
    expect(mapSevCreditNote(gutschrift, []).voucher.date).toBe(gutschrift.create!.slice(0, 10));
  });

  it("gilt mit Status 1000 als ausgeglichen, obwohl paidAmount fehlt", () => {
    expect(gutschrift.paidAmount).toBeUndefined();
    expect(mapSevCreditNote(gutschrift, []).payment).toMatchObject({ status: "balanced", openAmount: 0, paidDate: gutschrift.payDate!.slice(0, 10) });
  });
});

/* Die Beträge sind auf ±100 maskiert, die Summe mehrerer Zahlungen sagt hier also nichts über den Beleg. */
describe("Einzelzahlungen in Buchhaltungsversion 2.0", () => {
  const mapped = (logs: unknown[]) => mapSevPaymentLogs(logs.map((l) => sevCheckAccountTransactionLogSchema.parse(l)));

  it("behält beim Ausgabebeleg den negativen Betrag und nimmt das Datum des Umsatzes", () => {
    const byVoucher = mapped(zahlungenV2.ausgabebelege);
    expect([...byVoucher.keys()]).toEqual(zahlungenV2.ausgabebelege.map((l) => `voucher/${l.object.id}`));
    for (const log of zahlungenV2.ausgabebelege) {
      expect(log.bookingDate).toBe("<anon>");
      expect(byVoucher.get(`voucher/${log.object.id}`)).toMatchObject([{ amount: -10000, date: log.checkAccountTransaction.valueDate.slice(0, 10) }]);
    }
  });

  it("ordnet die Zahlung einer Rechnung mit positivem Betrag zu", () => {
    const { invoice, logs } = zahlungenV2.bezahlte_rechnung;
    expect(mapped(logs).get(`invoice/${invoice.id}`)).toMatchObject([{ amount: 10000, transactionId: logs[0]!.checkAccountTransaction.id }]);
  });

  it("führt mehrere Zahlungen einer Rechnung einzeln", () => {
    const { invoice, logs } = zahlungenV2.zwei_zahlungen_eine_rechnung;
    const items = mapped(logs).get(`invoice/${invoice.id}`)!;
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.transactionId)).size).toBe(2);
  });

  it("teilt einen Umsatz auf zwei Rechnungen auf", () => {
    const logs = zahlungenV2.ein_umsatz_zwei_rechnungen;
    const byVoucher = mapped(logs);
    expect(byVoucher.size).toBe(2);
    expect(new Set([...byVoucher.values()].flat().map((i) => i.transactionId)).size).toBe(1);
  });
});

describe("Vorlagen und Belege ohne Datei in Buchhaltungsversion 1.0", () => {
  it("übernimmt wiederkehrende Rechnungen nicht", () => {
    expect(vorlagenWkr.map((v) => v.invoice.accountIntervall)).toContain("P0Y0M1W");
    expect(vorlagenWkr.map((v) => v.invoice.status)).toEqual(expect.arrayContaining(["50", "100"]));
    for (const { invoice } of vorlagenWkr) expect(isSevInvoiceImportable(sevInvoiceSchema.parse(invoice))).toBe(false);
  });

  it("übernimmt Vorlagen wiederkehrender Belege in keinem Status", () => {
    expect(belegeRv.map((b) => b.voucher.status).sort()).toEqual(["100", "1000", "50"]);
    for (const { voucher } of belegeRv) expect(isSevVoucherImportable(sevVoucherSchema.parse(voucher))).toBe(false);
  });

  it("führt Belege ohne document ohne Datei", () => {
    for (const { voucher, positions } of belegeOhneDatei) {
      const parsed = sevVoucherSchema.parse(voucher);
      expect(isSevVoucherImportable(parsed)).toBe(true);
      expect(mapSevVoucher(parsed, positions as never[]).voucher.fileIds).toEqual([]);
    }
  });

  it("liest die Hülle von Document/download", () => {
    expect(sevFileResponseSchema.parse(dateiDownload)).toMatchObject({ objects: { base64Encoded: true, mimetype: "application/pdf" } });
  });
});
