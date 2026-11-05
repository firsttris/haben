import { describe, expect, it } from "vitest";
import { suggestMatches, type MatchTransaction, type OpenItem } from "./matching.ts";
import { formatEuro } from "./money.ts";
import { dueDate } from "./period.ts";
import {
  ohneAltbestand,
  purposeNamesPeriod,
  saeumnisMonate,
  saeumniszuschlag,
  vatPosten,
  vatPostenFaelligkeit,
  vatPostenLabel,
  vatPostenStand,
  type FiledVatReturn,
  type VatPayment,
} from "./ustva-posten.ts";

const faellig =
  (dauerfrist = false) =>
  (p: { year: number; month: number }) =>
    dueDate(p, "BY", dauerfrist);

const oktober: FiledVatReturn = { id: "okt", year: 2026, month: 10, kz83: 1_234_56, correctsId: null, abgabeTag: "2026-11-09" };

describe("Posten je abgegebener Voranmeldung", () => {
  it("Zahllast fällig am 10. des Folgemonats, mit Dauerfristverlängerung einen Monat später (§ 18 Abs. 1 UStG, § 46 UStDV)", () => {
    expect(vatPosten([oktober], faellig())).toEqual([
      { vatReturnId: "okt", year: 2026, month: 10, betrag: 1_234_56, berichtigt: false, faellig: "2026-11-10" },
    ]);
    expect(vatPosten([oktober], faellig(true))[0]!.faellig).toBe("2026-12-10");
  });

  it("Quartal: 10. des Monats nach Quartalsende; fällt er aufs Wochenende, der nächste Werktag", () => {
    // 10. Oktober 2026 ist ein Samstag
    const q3: FiledVatReturn = { ...oktober, id: "q3", month: 43, abgabeTag: "2026-10-01" };
    expect(vatPosten([q3], faellig())[0]!.faellig).toBe("2026-10-12");
  });

  it("verspätete Anmeldung: fällig nicht vor dem Eingang (§ 240 Abs. 1 Satz 3 AO)", () => {
    expect(vatPostenFaelligkeit("2026-11-10", "2026-11-20")).toBe("2026-11-20");
    expect(vatPostenFaelligkeit("2026-11-10", "2026-11-03")).toBe("2026-11-10");
    expect(vatPosten([{ ...oktober, abgabeTag: "2026-11-20" }], faellig())[0]!.faellig).toBe("2026-11-20");
  });

  it("Überschuss ist ein Eingang (negativer Betrag)", () => {
    expect(vatPosten([{ ...oktober, kz83: -500_00 }], faellig())[0]!.betrag).toBe(-500_00);
  });

  it("Dezember mit Sondervorauszahlung: Kz 83 enthält schon den Abzug (Kz 39), der Posten ist Kz 83", () => {
    // Kz 83 = Steuer 2.000 € − Kz 39 3.000 € = −1.000 €: Erstattung, fällig am 10. Februar mit Dauerfristverlängerung
    const dezember: FiledVatReturn = { ...oktober, id: "dez", month: 12, kz83: -1_000_00, abgabeTag: "2027-02-08" };
    expect(vatPosten([dezember], faellig(true))[0]).toMatchObject({ betrag: -1_000_00, faellig: "2027-02-10" });
  });

  it("berichtigte Anmeldung: eigener Posten über die Differenz, fällig frühestens mit ihrem Eingang; ohne Differenz kein Posten", () => {
    const berichtigt: FiledVatReturn = { id: "b1", year: 2026, month: 10, kz83: 1_500_00, correctsId: "okt", abgabeTag: "2026-12-01" };
    const gleich: FiledVatReturn = { id: "b2", year: 2026, month: 10, kz83: 1_500_00, correctsId: "b1", abgabeTag: "2026-12-02" };
    const posten = vatPosten([oktober, berichtigt, gleich], faellig());
    expect(posten.map((p) => [p.vatReturnId, p.betrag, p.berichtigt, p.faellig])).toEqual([
      ["okt", 1_234_56, false, "2026-11-10"],
      ["b1", 265_44, true, "2026-12-01"],
    ]);
  });
});

const zahlung = (id: string, amount: number, bookingDate: string, vatReturnId: string | null = "okt"): VatPayment => ({ id, amount, bookingDate, vatReturnId });

describe("Stand der Posten", () => {
  const posten = vatPosten([oktober], faellig());

  it("Teilzahlung lässt den Rest offen, die zweite Zahlung erledigt ihn", () => {
    const teil = vatPostenStand(posten, [zahlung("z1", -1_000_00, "2026-11-10")]).posten[0]!;
    expect(teil).toMatchObject({ bezahlt: 1_000_00, offen: 234_56 });
    const voll = vatPostenStand(posten, [zahlung("z1", -1_000_00, "2026-11-10"), zahlung("z2", -234_56, "2026-11-20")]).posten[0]!;
    expect(voll).toMatchObject({ bezahlt: 1_234_56, offen: 0 });
  });

  it("Erstattung: Eingang erledigt den Überschuss", () => {
    const erstattung = vatPosten([{ ...oktober, kz83: -300_00 }], faellig());
    expect(vatPostenStand(erstattung, [zahlung("e", 300_00, "2026-11-25")]).posten[0]).toMatchObject({ bezahlt: -300_00, offen: 0 });
  });

  it("Zahlung ohne Bezug gleicht einen Posten nur aus, wenn sie ihn genau trifft und nach Ende des Zeitraums gebucht ist", () => {
    const genau = vatPostenStand(posten, [zahlung("alt", -1_234_56, "2026-11-10", null)]);
    expect(genau.posten[0]).toMatchObject({ offen: 0, zahlungen: [{ id: "alt", ohneBezug: true }] });
    expect(genau.ohneBezug).toEqual([]);

    const anders = vatPostenStand(posten, [zahlung("alt", -1_000_00, "2026-11-10", null)]);
    expect(anders.posten[0]!.offen).toBe(1_234_56);
    expect(anders.ohneBezug.map((z) => z.id)).toEqual(["alt"]);

    const zuFrueh = vatPostenStand(posten, [zahlung("alt", -1_234_56, "2026-10-31", null)]);
    expect(zuFrueh.posten[0]!.offen).toBe(1_234_56);
  });

  it("eine Zahlung ohne Bezug gleicht nur einen Posten aus, den ältesten", () => {
    const november = { ...oktober, id: "nov", month: 11, abgabeTag: "2026-12-09" };
    const stand = vatPostenStand(vatPosten([oktober, november], faellig()), [zahlung("alt", -1_234_56, "2026-12-10", null)]);
    expect(stand.posten.map((p) => [p.vatReturnId, p.offen])).toEqual([
      ["okt", 0],
      ["nov", 1_234_56],
    ]);
  });

  it("Zahlungen ohne Bezug in beliebiger Reihenfolge: die früheste passende gleicht den ältesten Posten aus", () => {
    const september = { ...oktober, id: "sep", month: 9, abgabeTag: "2026-10-09" };
    // Die Lastschrift vom November (für Oktober) wurde vor der vom Oktober (für September) zugeordnet
    const stand = vatPostenStand(vatPosten([september, oktober], faellig()), [
      zahlung("nov", -1_234_56, "2026-11-10", null),
      zahlung("okt", -1_234_56, "2026-10-12", null),
    ]);
    expect(stand.posten.map((p) => [p.vatReturnId, p.offen, p.zahlungen.map((z) => z.id)])).toEqual([
      ["sep", 0, ["okt"]],
      ["okt", 0, ["nov"]],
    ]);
    expect(stand.ohneBezug).toEqual([]);
  });

  it("Altbestand ohne Zahlung mit Bezug ist kein Posten; seine Berichtigung bleibt ein Posten über die Differenz", () => {
    const berichtigt: FiledVatReturn = { id: "b", year: 2026, month: 10, kz83: 1_500_00, correctsId: "okt", abgabeTag: "2026-12-01" };
    const posten = vatPosten([oktober, berichtigt], faellig());
    expect(ohneAltbestand(posten, new Set(["okt"]), []).map((p) => [p.vatReturnId, p.betrag])).toEqual([["b", 265_44]]);
    const mitBezug = ohneAltbestand(posten, new Set(["okt"]), [zahlung("z", -100_00, "2026-11-10")]);
    expect(mitBezug.map((p) => p.vatReturnId)).toEqual(["okt", "b"]);
  });

  it("Berichtigung nach unten vor der Zahlung: verrechnet mit der Zahllast, offen bleibt nur der berichtigte Betrag", () => {
    const berichtigt: FiledVatReturn = { id: "b", year: 2026, month: 10, kz83: 1_000_00, correctsId: "okt", abgabeTag: "2026-11-09" };
    const stand = vatPostenStand(vatPosten([oktober, berichtigt], faellig()), []).posten;
    expect(stand.map((p) => [p.vatReturnId, p.betrag, p.verrechnet, p.offen])).toEqual([
      ["okt", 1_234_56, 234_56, 1_000_00],
      ["b", -234_56, -234_56, 0],
    ]);
  });

  it("Berichtigung nach unten nach voller Zahlung: der Unterschied ist eine Erstattung", () => {
    const berichtigt: FiledVatReturn = { id: "b", year: 2026, month: 10, kz83: 1_000_00, correctsId: "okt", abgabeTag: "2026-11-20" };
    const stand = vatPostenStand(vatPosten([oktober, berichtigt], faellig()), [zahlung("z", -1_234_56, "2026-11-10")]).posten;
    expect(stand.find((p) => p.vatReturnId === "b")).toMatchObject({ betrag: -234_56, offen: -234_56 });
  });
});

describe("Säumniszuschlag (§ 240 AO)", () => {
  it("1 % je angefangenem Monat vom auf 50 € abgerundeten Betrag", () => {
    expect(saeumniszuschlag(1_234_56, 1)).toBe(12_00);
    expect(saeumniszuschlag(1_234_56, 2)).toBe(24_00);
    expect(saeumniszuschlag(49_99, 1)).toBe(0);
    expect(saeumniszuschlag(-100_00, 1)).toBe(0);
  });

  it("drei Tage Schonfrist, danach zählt jeder angefangene Monat", () => {
    expect(saeumnisMonate("2026-11-10", "2026-11-10")).toBe(0);
    expect(saeumnisMonate("2026-11-10", "2026-11-13")).toBe(0);
    expect(saeumnisMonate("2026-11-10", "2026-11-14")).toBe(1);
    expect(saeumnisMonate("2026-11-10", "2026-12-10")).toBe(1);
    expect(saeumnisMonate("2026-11-10", "2026-12-11")).toBe(2);
    expect(saeumnisMonate("2027-01-31", "2027-03-05")).toBe(2);
  });
});

describe("Zeitraum im Verwendungszweck", () => {
  it.each([
    ["USt 10/26 StNr 198/113/10010", true],
    ["UST-VA 10.2026", true],
    ["Umsatzsteuer 2026/10", true],
    ["Umsatzsteuer Okt. 2026", true],
    ["USt Oktober 26", true],
    ["USt 11/26", false],
    ["Lastschrift vom 05.10.26 USt", false],
    ["USt 10/25", false],
  ])("Oktober 2026: %s", (purpose, expected) => {
    expect(purposeNamesPeriod(purpose, { year: 2026, month: 10 })).toBe(expected);
  });

  it.each([
    ["USt Q3/26", true],
    ["UST 3. VJ 2026", true],
    ["Umsatzsteuer 3.Quartal 2026", true],
    ["USt III/26", true],
    ["USt 43/26", true],
    ["USt Q4/26", false],
    ["USt II/26", false],
  ])("3. Quartal 2026: %s", (purpose, expected) => {
    expect(purposeNamesPeriod(purpose, { year: 2026, month: 43 })).toBe(expected);
  });

  it("Bezeichnung für Liste und Auswahl", () => {
    expect(vatPostenLabel({ year: 2026, month: 3 })).toBe("USt 03/2026");
    expect(vatPostenLabel({ year: 2026, month: 43 })).toBe("USt Q3/2026");
  });
});

describe("Vorschlag im Bankabgleich", () => {
  const item = (open: number, period = { year: 2026, month: 10 }): OpenItem => ({
    type: "ustva",
    id: `ustva-${period.month}`,
    number: vatPostenLabel(period),
    date: "2026-11-09",
    dueDate: "2026-11-10",
    open,
    partyName: "Finanzamt",
    partyIbans: [],
    period,
  });
  const lastschrift = (amount: number, purpose: string, counterpartyName = "Finanzamt Regensburg", bookingDate = "2026-11-10"): MatchTransaction => ({
    amount,
    purpose,
    counterpartyName,
    bookingDate,
  });

  it("Lastschrift über die Zahllast mit Zeitraum im Verwendungszweck", () => {
    const [best] = suggestMatches(lastschrift(-1_234_56, "USt 10/26 StNr 198/113/10010"), [item(-1_234_56)]);
    expect(best).toMatchObject({ amount: -1_234_56, reasons: ["Betrag stimmt exakt", "Zeitraum im Verwendungszweck", "Finanzamt als Gegenpartei"] });
  });

  it("zwei Zeiträume mit demselben Betrag: der genannte gewinnt", () => {
    const [best] = suggestMatches(lastschrift(-1_234_56, "USt 11/26"), [item(-1_234_56), item(-1_234_56, { year: 2026, month: 11 })]);
    expect(best!.item.id).toBe("ustva-11");
  });

  it("Erstattung des Finanzamts auf einen Überschuss", () => {
    const [best] = suggestMatches(lastschrift(500_00, "Erstattung USt 10/26"), [item(500_00)]);
    expect(best).toMatchObject({ amount: 500_00 });
  });

  it("Teilzahlung mit Zeitraum: zugeordnet wird der Umsatz, der Rest bleibt offen", () => {
    const [best] = suggestMatches(lastschrift(-1_000_00, "USt 10/26"), [item(-1_234_56)]);
    expect(best).toMatchObject({ amount: -1_000_00, reasons: ["Teilbetrag des offenen Betrags", "Zeitraum im Verwendungszweck", "Finanzamt als Gegenpartei"] });
  });

  it("Lastschrift mit Säumniszuschlag: zugeordnet wird die Zahllast, der Zuschlag bleibt für den Beleg", () => {
    const [best] = suggestMatches(lastschrift(-1_246_56, "Finanzkasse", "Finanzamt Regensburg", "2026-11-20"), [item(-1_234_56)]);
    expect(best).toMatchObject({
      amount: -1_234_56,
      reasons: [`Zahllast und ${formatEuro(12_00)} Säumniszuschlag (§ 240 AO, 1 Monat)`, "Finanzamt als Gegenpartei"],
    });
  });

  it("nicht bei anderer Steuer, Sondervorauszahlung oder einer Zahlung ohne Bezug zum Finanzamt", () => {
    expect(suggestMatches(lastschrift(-1_234_56, "Einkommensteuer 10/26"), [item(-1_234_56)])).toEqual([]);
    expect(suggestMatches(lastschrift(-1_234_56, "USt Sondervorauszahlung 2026"), [item(-1_234_56)])).toEqual([]);
    expect(suggestMatches(lastschrift(-1_234_56, "Rechnung 4711", "Hetzner Online GmbH"), [item(-1_234_56)])).toEqual([]);
  });

  it("nur in der Richtung des Postens", () => {
    expect(suggestMatches(lastschrift(1_234_56, "USt 10/26"), [item(-1_234_56)])).toEqual([]);
  });
});
