import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import gutschriften from "../../test-fixtures/sevdesk/buchhaltung-2.0/gutschrift-kategorien.json" with { type: "json" };
import { parseDatevBuchungsstapel } from "../datev.ts";
import { isSevCreditNoteImportable, mapSevCreditNote } from "./map.ts";
import { sevCreditNoteSchema } from "./types.ts";

/*
 * Gutschriften je `bookingCategory` aus Buchhaltungsversion 2.0, je 1 € netto mit 19 %, fertiggestellt, nicht bezahlt, dazu
 * `GET /AccountingType/{id}` des Kontos am Kopf und der DATEV-Export (#472). Anders als in 1.0 trägt der Kopf `taxRule` 9,
 * `taxType` null und `taxRate` 0; die 19 % stehen nur an den Positionen.
 */

const notes = gutschriften;
const byCategory = (category: string) => notes.find((n) => n.creditNote.bookingCategory === category)!;
const datei = (name: string) => readFileSync(new URL(`../../test-fixtures/sevdesk/buchhaltung-2.0/${name}`, import.meta.url));

describe("Gutschriften je Buchungskategorie in Buchhaltungsversion 2.0", () => {
  it("enthält Provision und beide Honorar-Kategorien, alle fertiggestellt", () => {
    expect(notes.map((n) => n.creditNote.bookingCategory)).toEqual(["PROVISION", "ROYALTY_ASSIGNED", "ROYALTY_UNASSIGNED"]);
    for (const { creditNote } of notes) {
      expect(creditNote).toMatchObject({ status: "200", creditNoteType: "CN", taxRule: { id: "9" }, taxType: null, taxRate: "0" });
      expect(isSevCreditNoteImportable(sevCreditNoteSchema.parse(creditNote))).toBe(true);
    }
  });

  it("nennt am Kopf nur die ID des Buchungskontos, Name und Kontonummern liefert AccountingType", () => {
    for (const { creditNote, accountingType } of notes) {
      expect(Object.keys(creditNote.accountingType).sort()).toEqual(["id", "objectName"]);
      expect(accountingType.id).toBe(creditNote.accountingType.id);
    }
    expect(byCategory("PROVISION").accountingType).toMatchObject({ name: "Verkaufsprovision", type: "DC", skr03: "4760", skr04: "6770" });
    expect(byCategory("ROYALTY_ASSIGNED").accountingType).toMatchObject({ type: "", skr03: "3100", skr04: "5900" });
    expect(byCategory("ROYALTY_UNASSIGNED").accountingType).toMatchObject({ type: "IC", skr03: "4909", skr04: "6303" });
  });

  it.each([["PROVISION"], ["ROYALTY_ASSIGNED"]])("nimmt bei %s die 19 % aus den Positionen, obwohl der Kopf 0 nennt", (category) => {
    const { creditNote, positions } = byCategory(category);
    const { voucher } = mapSevCreditNote(sevCreditNoteSchema.parse(creditNote), positions as never[]);
    expect(voucher).toMatchObject({ type: "creditnote", net: -100, tax: -19, gross: -119 });
    expect(voucher.taxes).toEqual([{ rate: 1900, net: -100, tax: -19 }]);
  });

  it("übernimmt die Gutschrift über 0 € ohne Betrag", () => {
    const { creditNote, positions } = byCategory("ROYALTY_UNASSIGNED");
    const { voucher } = mapSevCreditNote(sevCreditNoteSchema.parse(creditNote), positions as never[]);
    expect(voucher).toMatchObject({ net: 0, tax: 0, gross: 0 });
  });
});

describe("DATEV-Export der Gutschriften aus Buchhaltungsversion 2.0", () => {
  const buchungen = parseDatevBuchungsstapel(new Uint8Array(datei("extf-buchungsstapel-gutschriften.csv"))).bookings;

  it("bucht Provision und Honorar im Soll des Aufwandskontos aus AccountingType mit BU 9", () => {
    expect(buchungen.map((b) => b.account)).toEqual([byCategory("PROVISION").accountingType.skr03, byCategory("ROYALTY_ASSIGNED").accountingType.skr03]);
    for (const b of buchungen) {
      expect(b).toMatchObject({ side: "S", contraAccount: "70001", buKey: "9", amount: 119, euTaxRate: 1900 });
    }
  });

  it("legt für die Gutschrift über 0 € keine Buchung an", () => {
    expect(buchungen.map((b) => b.account)).not.toContain(byCategory("ROYALTY_UNASSIGNED").accountingType.skr03);
  });

  it("findet zu jedem Beleglink das Belegbild unter Rechnungsausgang", () => {
    const xml = datei("document-rechnungsausgang-gutschriften.xml").toString("utf8");
    for (const b of buchungen) {
      const guid = b.documentLink.match(/[0-9a-f-]{36}/)![0];
      expect(xml).toMatch(new RegExp(`guid="${guid}" type="2"><extension name="[^"]*_${b.voucherField1}_`));
    }
  });
});
