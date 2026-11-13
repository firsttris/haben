import { describe, expect, it } from "vitest";
import { documentSplitPosting } from "./document-split.ts";
import { computeInvoiceTotals } from "./invoice.ts";
import { ACCOUNTS, documentPosting, documentWriteOffPosting, EXPENSE_CATEGORIES, settlementTaxShares, vorsteuerAusgleichPosting } from "./posting.ts";

/*
 * Gutschrift, die bereits Bezahltes erstattet (#786): Die Vorsteuerminderung hängt nicht an der Versteuerungsart, sondern
 * daran, was die Gutschrift mindert. Mindert sie ein bezahltes Entgelt (Guthaben aus der Jahresabrechnung, Bonus), wird
 * sie nach § 17 Abs. 1 Satz 2 und 8 UStG erst berichtigt, wenn das Geld zurückkommt oder verrechnet wird. Bis dahin steht
 * der Betrag auf dem Zwischenkonto wie „Umsatzsteuer nicht fällig“ (1766/1761) auf der Erlösseite: mit Steuerschlüssel und
 * Bemessungsgrundlage, aber in keiner Kennzahl. Ohne die Angabe bleibt alles wie bisher, im Belegmonat auf der Vorsteuer.
 */

/** Gutschrift über 100,00 € netto, 19 % */
const gutschrift = computeInvoiceTotals([{ quantity: 1000, unitPrice: -10_000, taxRate: 1900 }]);
/** Gutschrift über 100,00 € netto, 7 % */
const gutschrift7 = computeInvoiceTotals([{ quantity: 1000, unitPrice: -10_000, taxRate: 700 }]);

const KONTEN: Record<"SKR03" | "SKR04", { zwischen: string; vorsteuer: string; vorsteuer7: string }> = {
  SKR03: { zwischen: "1548", vorsteuer: "1576", vorsteuer7: "1571" },
  SKR04: { zwischen: "1434", vorsteuer: "1406", vorsteuer7: "1401" },
};

describe("documentPosting: Gutschrift mit „erstattet bereits Bezahltes“", () => {
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];
    const aufwand = EXPENSE_CATEGORIES.software[kontenrahmen];

    it(`${kontenrahmen}: die Vorsteuerminderung steht auf dem Zwischenkonto, nicht auf der Vorsteuer`, () => {
      const lines = documentPosting(gutschrift, "software", kontenrahmen, "einzelunternehmen", "bank", true, undefined, 0, null, true);
      expect(lines).toEqual([
        { account: aufwand, debit: 0, credit: 10_000, taxCode: "VSt19" },
        { account: k.zwischen, debit: 0, credit: 1_900, taxCode: "VSt19" },
        { account: ACCOUNTS[kontenrahmen].verbindlichkeiten, debit: 11_900, credit: 0, taxCode: null },
      ]);
      expect(lines.some((l) => l.account === k.vorsteuer)).toBe(false);
    });

    it(`${kontenrahmen}: ohne die Angabe mindert sie die Vorsteuer wie bisher`, () => {
      const lines = documentPosting(gutschrift, "software", kontenrahmen, "einzelunternehmen", "bank", true, undefined, 0, null, false);
      expect(lines).toEqual([
        { account: aufwand, debit: 0, credit: 10_000, taxCode: "VSt19" },
        { account: k.vorsteuer, debit: 0, credit: 1_900, taxCode: "VSt19" },
        { account: ACCOUNTS[kontenrahmen].verbindlichkeiten, debit: 11_900, credit: 0, taxCode: null },
      ]);
    });

    it(`${kontenrahmen}: auch 7 % geht auf das Zwischenkonto, mit dem Steuerschlüssel des Satzes`, () => {
      const lines = documentPosting(gutschrift7, "software", kontenrahmen, "einzelunternehmen", "bank", true, undefined, 0, null, true);
      expect(lines).toContainEqual({ account: k.zwischen, debit: 0, credit: 700, taxCode: "VSt7" });
      expect(lines).toContainEqual({ account: aufwand, debit: 0, credit: 10_000, taxCode: "VSt7" });
    });

    it(`${kontenrahmen}: Kleinunternehmer ziehen keine Vorsteuer ab, also steht auch nichts auf dem Zwischenkonto`, () => {
      const lines = documentPosting(gutschrift, "software", kontenrahmen, "einzelunternehmen", "bank", false, undefined, 0, null, true);
      expect(lines).toEqual([
        { account: aufwand, debit: 0, credit: 11_900, taxCode: "keineVSt" },
        { account: ACCOUNTS[kontenrahmen].verbindlichkeiten, debit: 11_900, credit: 0, taxCode: null },
      ]);
    });
  }

  it("an einer positiven Rechnung wird die Angabe abgelehnt", () => {
    const rechnung = computeInvoiceTotals([{ quantity: 1000, unitPrice: 10_000, taxRate: 1900 }]);
    expect(() => documentPosting(rechnung, "software", "SKR03", "einzelunternehmen", "bank", true, undefined, 0, null, true)).toThrow(
      /nur an einer Gutschrift/,
    );
  });

  it("§ 13b bleibt außen vor: dort gibt es keine Vorsteuer aus der Rechnung, die warten könnte", () => {
    const totals = { ...gutschrift, gross: gutschrift.net };
    expect(() => documentPosting(totals, "software", "SKR03", "einzelunternehmen", "bank", true, undefined, 0, "eu", true)).toThrow(RangeError);
  });

  it("mit Aufteilung steht die Vorsteuer je Satz ebenfalls auf dem Zwischenkonto", () => {
    const totals = computeInvoiceTotals([{ quantity: 1000, unitPrice: -10_000, taxRate: 1900 }]);
    const lines = documentSplitPosting(
      totals,
      [
        { category: "wareneinkauf", taxRate: 1900, net: -6_000, tax: -1_140 },
        { category: "software", taxRate: 1900, net: -4_000, tax: -760 },
      ],
      "SKR04",
      "einzelunternehmen",
      "bank",
      true,
      null,
      true,
    );
    expect(lines).toContainEqual({ account: "1434", debit: 0, credit: 1_900, taxCode: "VSt19" });
    expect(lines.some((l) => l.account === "1406")).toBe(false);
  });
});

describe("vorsteuerAusgleichPosting: Umbuchung beim Ausgleich", () => {
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];

    it(`${kontenrahmen}: 19 % geht vom Zwischenkonto auf die Vorsteuer, mit Steuerschlüssel und Bemessungsgrundlage`, () => {
      const shares = settlementTaxShares(gutschrift, 0, [], 11_900);
      expect(vorsteuerAusgleichPosting(shares, kontenrahmen)).toEqual([
        { account: k.zwischen, debit: 1_900, credit: 0, taxCode: "VSt19", basis: 10_000 },
        { account: k.vorsteuer, debit: 0, credit: 1_900, taxCode: "VSt19" },
      ]);
    });

    it(`${kontenrahmen}: 7 % mit dem Steuerschlüssel des Satzes`, () => {
      const shares = settlementTaxShares(gutschrift7, 0, [], 10_700);
      expect(vorsteuerAusgleichPosting(shares, kontenrahmen)).toEqual([
        { account: k.zwischen, debit: 700, credit: 0, taxCode: "VSt7", basis: 10_000 },
        { account: k.vorsteuer7, debit: 0, credit: 700, taxCode: "VSt7" },
      ]);
    });

    it(`${kontenrahmen}: eine Gegenbuchung dreht beide Seiten und die Bemessungsgrundlage`, () => {
      const shares = settlementTaxShares(gutschrift, 0, [], 11_900);
      const gegen = vorsteuerAusgleichPosting(shares, kontenrahmen).map((l) => ({
        ...l,
        debit: l.credit,
        credit: l.debit,
        ...(l.basis != null ? { basis: -l.basis } : {}),
      }));
      expect(gegen).toEqual([
        { account: k.zwischen, debit: 0, credit: 1_900, taxCode: "VSt19", basis: -10_000 },
        { account: k.vorsteuer, debit: 1_900, credit: 0, taxCode: "VSt19" },
      ]);
    });

    it(`${kontenrahmen}: 0 % hat nichts auf dem Zwischenkonto, also wird nichts umgebucht`, () => {
      const ohneSteuer = computeInvoiceTotals([{ quantity: 1000, unitPrice: -10_000, taxRate: 0 }]);
      expect(vorsteuerAusgleichPosting(settlementTaxShares(ohneSteuer, 0, [], 10_000), kontenrahmen)).toEqual([]);
    });
  }
});

describe("documentWriteOffPosting: Skonto auf eine Gutschrift „erstattet bereits Bezahltes“", () => {
  // 7,80 € netto, 1,48 € Vorsteuer, 9,28 € brutto; 5,80 € erstattet, 3,48 € als Skonto ausgebucht. Der Anteil des
  // Skontos ist der Rest nach der Erstattung (55), nicht der Anteil des Skontobetrags für sich (56): sonst stünde ein
  // Cent zu viel Vorsteuer und ein Cent bliebe auf dem Zwischenkonto stehen (#786).
  const klein = { net: -780, tax: -148, gross: -928, taxes: [{ rate: 1900 as const, base: -780, tax: -148 }] };

  it("schreibt den Rest des Zwischenkontos ab, mit der Bemessungsgrundlage des Skontos", () => {
    const anteile = [{ rate: 1900 as const, base: -293, tax: -55 }];
    expect(documentWriteOffPosting(klein, 348, "SKR03", true, anteile)).toEqual([
      { account: ACCOUNTS.SKR03.verbindlichkeiten, debit: 0, credit: 348, taxCode: null },
      { account: ACCOUNTS.SKR03.skontiErhalten, debit: 293, credit: 0, taxCode: "VSt19" },
      { account: ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar, debit: 55, credit: 0, taxCode: "VSt19", basis: -293 },
    ]);
  });

  it("ohne Anteile bucht es wie bisher auf die Vorsteuer", () => {
    const lines = documentWriteOffPosting(klein, 348, "SKR03", true);
    expect(lines.some((l) => l.account === ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar)).toBe(false);
    expect(lines.some((l) => l.account === ACCOUNTS.SKR03.vorsteuer[1900])).toBe(true);
  });
});
