import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import asset from "../../test-fixtures/sevdesk/buchhaltung-2.0/asset.json" with { type: "json" };
import belegeSteuerregel from "../../test-fixtures/sevdesk/buchhaltung-2.0/belege-steuerregel.json" with { type: "json" };
import dokumente from "../../test-fixtures/sevdesk/buchhaltung-2.0/dokumente-mit-rechnungsbezug.json" with { type: "json" };
import gutschrift from "../../test-fixtures/sevdesk/buchhaltung-2.0/gutschrift-underachievement.json" with { type: "json" };
import mahnungMitRechnung from "../../test-fixtures/sevdesk/buchhaltung-2.0/mahnung-mit-rechnung.json" with { type: "json" };
import { parseDatevBuchungsstapel } from "../datev.ts";
import { isSevCreditNoteImportable, isSevInvoiceImportable, mapSevCreditNote, mapSevVoucher } from "./map.ts";
import { sevCreditNoteSchema, sevInvoiceSchema, sevVoucherSchema } from "./types.ts";

/* Zweite Runde anonymisierter Antworten aus Buchhaltungsversion 2.0 (#472). Beträge sind auf ±100 maskiert. */

const steuerregel = (beleg: (typeof belegeSteuerregel)[number]) => beleg.voucher.taxRule.id;
const abgebildet = (beleg: (typeof belegeSteuerregel)[number]) => mapSevVoucher(sevVoucherSchema.parse(beleg.voucher), beleg.positions as never[]).voucher;

describe("Belege mit taxRule 12 und 14 in Buchhaltungsversion 2.0", () => {
  it("enthält Reverse Charge (12), Regel 14 und Regel 9 zum Vergleich", () => {
    expect(belegeSteuerregel.map(steuerregel)).toEqual(["12", "12", "14", "9"]);
    for (const { voucher } of belegeSteuerregel) expect(voucher.taxType).toBeNull();
  });

  it("führt alle als Ausgabe", () => {
    for (const beleg of belegeSteuerregel) {
      expect(beleg.voucher.creditDebit).toBe("C");
      expect(abgebildet(beleg)).toMatchObject({ direction: "ausgabe", type: "purchaseinvoice" });
    }
  });

  it("trägt bei 12 und 14 weder im Kopf noch an der Position Steuer, anders als bei Regel 9", () => {
    for (const beleg of belegeSteuerregel) {
      const ohneSteuer = steuerregel(beleg) !== "9";
      expect(abgebildet(beleg).tax === 0).toBe(ohneSteuer);
      for (const p of beleg.positions) expect(p.taxRate).toBe(ohneSteuer ? "0" : "19");
    }
  });
});

describe("Mahnung in Buchhaltungsversion 2.0", () => {
  const { mahnung } = mahnungMitRechnung;
  const gemahnt = mahnungMitRechnung.gemahnte_rechnung[0]!;

  it("übernimmt die Mahnung nicht und verweist mit origin auf die Rechnung", () => {
    expect(mahnung).toMatchObject({ invoiceType: "MA", dunningLevel: "1", origin: { id: gemahnt.id, objectName: "Invoice" } });
    expect(isSevInvoiceImportable(sevInvoiceSchema.parse(mahnung))).toBe(false);
  });

  it("führt den Betrag nur in reminderTotal, reminderDebit ist 0", () => {
    expect(mahnung).toMatchObject({ sumGross: "0.00", reminderDebit: "0.00", reminderCharge: "0.00" });
    expect(Number(mahnung.reminderTotal)).toBeGreaterThan(0);
  });

  it("trägt die Stufe an der gemahnten Rechnung, deren reminder-Beträge bleiben leer", () => {
    expect(gemahnt).toMatchObject({ invoiceType: "RE", dunningLevel: "1", reminderTotal: null, reminderDebit: null });
    expect(isSevInvoiceImportable(sevInvoiceSchema.parse(gemahnt))).toBe(true);
  });
});

describe("Gutschrift UNDERACHIEVEMENT in Buchhaltungsversion 2.0", () => {
  const { creditNote, positions } = gutschrift;

  it("verweist ohne Buchungskonto auf die Rechnung", () => {
    expect(creditNote.bookingCategory).toBe("UNDERACHIEVEMENT");
    expect(creditNote).not.toHaveProperty("accountingType");
    expect(creditNote.origin).toMatchObject({ objectName: "Invoice", id: creditNote.refSrcInvoice.id });
  });

  it("führt Positionen ohne Konto und positive Beträge", () => {
    expect(positions.length).toBeGreaterThan(0);
    for (const p of positions) {
      expect(Number(p.sumGross)).toBeGreaterThan(0);
      expect(p).not.toHaveProperty("accountingType");
      expect(p).not.toHaveProperty("accountDatev");
    }
  });

  it("übernimmt sie als negative Einnahme", () => {
    const parsed = sevCreditNoteSchema.parse(creditNote);
    expect(isSevCreditNoteImportable(parsed)).toBe(true);
    expect(mapSevCreditNote(parsed, positions as never[]).voucher).toMatchObject({ type: "creditnote", direction: "einnahme", gross: -10000 });
  });
});

describe("Anlagen und Dokumente in Buchhaltungsversion 2.0", () => {
  it("verweist eine Anlage auf ein DATEV-Konto statt auf ein Buchungskonto", () => {
    const [anlage] = asset.objects;
    expect(anlage).toMatchObject({ objectName: "Asset", accountDatev: { objectName: "AccountDatev" } });
    expect(anlage).not.toHaveProperty("accountingType");
  });

  it("führt bei Dateien zu einer Rechnung die Rechnung als baseObject und den Kontakt als object", () => {
    for (const dokument of dokumente) {
      expect(dokument).toMatchObject({ objectName: "Document", object: { objectName: "Contact" }, baseObject: { objectName: "Invoice" } });
    }
  });
});

describe("DATEV-Auszug aus Buchhaltungsversion 2.0", () => {
  const datei = (name: string) => readFileSync(new URL(`../../test-fixtures/sevdesk/buchhaltung-2.0/${name}`, import.meta.url));
  const buchungen = parseDatevBuchungsstapel(new Uint8Array(datei("extf-buchungsstapel-auszug.csv"))).bookings;
  const dateien = ["document-rechnungsausgang.xml", "document-rechnungseingang.xml"].flatMap((name) => [
    ...datei(name)
      .toString("utf8")
      .matchAll(/guid="([0-9a-f-]{36})"[^>]*><extension name="[^_]+_[^_]+_(.+?)_[0-9a-f]{32}\.pdf"/g),
  ]);

  it("liest Rechnung, Ausgabebeleg, Zahlung und Gutschrift", () => {
    expect(buchungen.map((b) => b.side)).toEqual(["H", "H", "H", "S"]);
  });

  it("findet zu jedem Beleglink eine Datei mit der Belegnummer der Buchung", () => {
    const mitLink = buchungen.filter((b) => b.documentLink);
    expect(mitLink).toHaveLength(3);
    for (const b of mitLink) {
      const passend = dateien.find(([, guid]) => b.documentLink.includes(guid!));
      expect(passend?.[2]).toBe(b.voucherField1);
    }
  });

  it("kürzt bei der Zahlung die Nummer auf die letzten 36 Zeichen, ohne Beleglink", () => {
    const zahlung = buchungen.find((b) => b.account === "1201")!;
    expect(zahlung).toMatchObject({ documentLink: "" });
    expect(zahlung.voucherField1).toHaveLength(36);
    expect(zahlung.voucherField1.startsWith("-")).toBe(true);
  });
});
