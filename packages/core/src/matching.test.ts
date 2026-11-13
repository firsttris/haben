import { describe, expect, it } from "vitest";
import { skontoZahlfristen } from "./skonto.ts";
import { purposeContainsNumber, suggestLohnsteuer, suggestMatches, transactionHasReference, type OpenItem } from "./matching.ts";

const invoice = (over: Partial<OpenItem> = {}): OpenItem => ({
  type: "invoice",
  id: "r31",
  number: "2026-031",
  date: "2026-09-05",
  dueDate: "2026-09-19",
  open: 476_000,
  partyName: "Nordwerk Software GmbH",
  partyIbans: ["DE89370400440532013000"],
  ...over,
});

const tx = {
  bookingDate: "2026-10-01",
  amount: 476_000,
  counterpartyName: "NORDWERK SOFTWARE GMBH",
  counterpartyIban: "DE89 3704 0044 0532 0130 00",
  purpose: "RE 2026 031 Leistungen August",
};

describe("suggestMatches", () => {
  it("bester Treffer mit allen Begründungen", () => {
    const [best] = suggestMatches(tx, [invoice(), invoice({ id: "r32", number: "2026-032", open: 595_000, partyIbans: [] })]);
    expect(best?.item.id).toBe("r31");
    expect(best?.reasons).toEqual(["Betrag stimmt exakt", "Rechnungsnummer im Verwendungszweck", "IBAN bekannt vom Kontakt", "Name passt"]);
    expect(best?.amount).toBe(476_000);
  });

  it("Teilzahlung mit Rechnungsnummer", () => {
    const [best] = suggestMatches({ ...tx, amount: 200_000, counterpartyIban: null }, [invoice()]);
    expect(best?.reasons).toContain("Teilbetrag des offenen Betrags");
    expect(best?.amount).toBe(200_000);
  });

  describe("Skonto auf eigene Rechnungen", () => {
    // Rechnung vom 05.09.2026 über 4.760,00 €: 2 % in 10 Tagen (bis 15.09.), 1 % in 20 Tagen (bis 25.09.)
    const skonto = skontoZahlfristen(
      [
        { days: 10, percent: 200 },
        { days: 20, percent: 100 },
      ],
      "2026-09-05",
      476_000,
      "BY",
    );
    const withSkonto = invoice({ skonto });

    it("Zahlung in der Frist um das Skonto gekürzt: Vorschlag mit dem Rest als Skonto", () => {
      const [best] = suggestMatches({ ...tx, bookingDate: "2026-09-15", amount: 466_480 }, [withSkonto]);
      expect(best?.reasons[0]).toBe("Betrag stimmt mit 2\u00a0% Skonto (95,20\u00a0€), in der Frist");
      expect(best?.score).toBe(50 + 40 + 30 + 15);
      expect(best).toMatchObject({ amount: 466_480, skonto: 9_520 });
      // Die zweite Stufe bis zu ihrem letzten Tag
      expect(suggestMatches({ ...tx, bookingDate: "2026-09-25", amount: 471_240 }, [withSkonto])[0]?.skonto).toBe(4_760);
    });

    it("nach der Frist oder mit anderem Betrag nur ein Teilbetrag, ohne Skonto", () => {
      const [late] = suggestMatches({ ...tx, bookingDate: "2026-09-16", amount: 466_480 }, [withSkonto]);
      expect(late?.reasons[0]).toBe("Teilbetrag des offenen Betrags");
      expect(late?.skonto).toBeUndefined();
      expect(suggestMatches({ ...tx, bookingDate: "2026-09-10", amount: 466_481 }, [withSkonto])[0]?.skonto).toBeUndefined();
      // Voller Betrag: kein Skonto
      expect(suggestMatches({ ...tx, bookingDate: "2026-09-10" }, [withSkonto])[0]).toMatchObject({
        amount: 476_000,
        reasons: expect.arrayContaining(["Betrag stimmt exakt"]),
      });
      expect(suggestMatches({ ...tx, bookingDate: "2026-09-10" }, [withSkonto])[0]?.skonto).toBeUndefined();
    });

    it("Fristende am Sonntag: Zahlung am Montag gilt nach § 193 BGB noch als rechtzeitig, am Dienstag nicht", () => {
      // Rechnung vom 24.09.2026, 2 % in 10 Tagen: Frist bis Sonntag, 04.10.2026
      const sunday = invoice({ skonto: skontoZahlfristen([{ days: 10, percent: 200 }], "2026-09-24", 476_000, "BY") });
      expect(suggestMatches({ ...tx, bookingDate: "2026-10-05", amount: 466_480 }, [sunday])[0]?.skonto).toBe(9_520);
      expect(suggestMatches({ ...tx, bookingDate: "2026-10-06", amount: 466_480 }, [sunday])[0]?.skonto).toBeUndefined();
    });

    it("Fristende am Feiertag: Zahlung am nächsten Werktag noch rechtzeitig", () => {
      // Rechnung vom 25.05.2026: Frist bis Fronleichnam, Donnerstag 04.06.2026, in Bayern Feiertag, in Berlin nicht
      const bayern = invoice({ skonto: skontoZahlfristen([{ days: 10, percent: 200 }], "2026-05-25", 476_000, "BY") });
      const berlin = invoice({ skonto: skontoZahlfristen([{ days: 10, percent: 200 }], "2026-05-25", 476_000, "BE") });
      expect(suggestMatches({ ...tx, bookingDate: "2026-06-05", amount: 466_480 }, [bayern])[0]?.skonto).toBe(9_520);
      expect(suggestMatches({ ...tx, bookingDate: "2026-06-05", amount: 466_480 }, [berlin])[0]?.skonto).toBeUndefined();
    });

    it("Skonto allein mit dem Betrag reicht für einen Vorschlag wie ein exakter Betrag", () => {
      const anonymous = { bookingDate: "2026-09-12", amount: 466_480, counterpartyName: "Unbekannt", counterpartyIban: null, purpose: "Danke" };
      expect(suggestMatches(anonymous, [withSkonto])[0]).toMatchObject({ score: 50, skonto: 9_520 });
    });
  });

  it("nur gleiche Richtung: Ausgang passt nicht auf Forderung", () => {
    expect(suggestMatches({ ...tx, amount: -476_000 }, [invoice()])).toEqual([]);
  });

  it("Beleg über Betrag und Datum", () => {
    const doc: OpenItem = {
      type: "document",
      id: "b1",
      number: "R0018834512",
      date: "2026-09-28",
      open: -3_856,
      partyName: "Hetzner Online GmbH",
      partyIbans: [],
    };
    const [best] = suggestMatches(
      { bookingDate: "2026-09-30", amount: -3_856, counterpartyName: "Hetzner Online GmbH", purpose: "Rechnung R0018834512 Server" },
      [doc],
    );
    expect(best?.reasons).toEqual(["Betrag stimmt exakt", "Rechnungsnummer im Verwendungszweck", "Name passt", "Datum passt (± 5 Tage)"]);
  });

  describe("Überweisung aus Haben (SEPA-Datei)", () => {
    const doc = (over: Partial<OpenItem> = {}): OpenItem => ({
      type: "document",
      id: "b2",
      number: "RE-0815",
      date: "2026-08-01",
      open: -11_900,
      partyName: "Büro Müller",
      partyIbans: ["DE02120300000000202051"],
      references: ["HABEN-0A1B2C3D4E5F6071"],
      ...over,
    });
    const debit = { bookingDate: "2026-11-06", amount: -11_662, counterpartyName: "Buero Mueller", counterpartyIban: null, purpose: "Sammler" };

    it("findet den Beleg an der EndToEndId, auch mit Skonto abgezogen und ohne Rechnungsnummer", () => {
      const [best] = suggestMatches({ ...debit, endToEndId: "HABEN-0A1B2C3D4E5F6071" }, [doc(), doc({ id: "b3", references: [] })]);
      expect(best?.item.id).toBe("b2");
      expect(best?.reasons).toEqual(["Teilbetrag des offenen Betrags", "Überweisung aus Haben (HABEN-0A1B2C3D4E5F6071)"]);
      expect(best?.amount).toBe(-11_662);
    });

    it("liest die Referenz auch aus Kundenreferenz und Verwendungszweck", () => {
      expect(transactionHasReference({ purpose: "", bankReference: "haben-0a1b2c3d4e5f6071" }, "HABEN-0A1B2C3D4E5F6071")).toBe(true);
      expect(transactionHasReference({ purpose: "RE-0815 EREF: HABEN 0A1B2C3D4E5F6071 SVWZ" }, "HABEN-0A1B2C3D4E5F6071")).toBe(true);
      expect(transactionHasReference({ purpose: "RE-0815" }, "HABEN-0A1B2C3D4E5F6071")).toBe(false);
      // Zu kurze Referenzen träfen zufällig
      expect(transactionHasReference({ purpose: "abc" }, "ABC")).toBe(false);
    });

    it("die IBAN des Lieferanten zählt auch bei Belegen", () => {
      const [best] = suggestMatches({ ...debit, amount: -11_900, counterpartyIban: "DE02 1203 0000 0000 2020 51" }, [doc({ references: [] })]);
      expect(best?.reasons).toEqual(["Betrag stimmt exakt", "IBAN des Lieferanten"]);
    });
  });

  it("schwache Treffer fallen weg", () => {
    expect(suggestMatches({ ...tx, amount: 1_000, purpose: "x", counterpartyIban: null, counterpartyName: "Fremd" }, [invoice()])).toEqual([]);
  });

  it("Rechnungsnummer ohne Trennzeichen", () => {
    expect(purposeContainsNumber("Rg.Nr. 2026031 vielen Dank", "2026-031")).toBe(true);
    expect(purposeContainsNumber("Abschlag 12", "12")).toBe(false);
  });
});

describe("suggestMatches mit Fremdwährung", () => {
  it("schlägt eine Fremdwährungsrechnung vor, wenn die Zahlung nur um die Kursdifferenz abweicht", () => {
    const item = {
      type: "invoice" as const,
      id: "r1",
      number: "RE-2026-0042",
      date: "2026-09-01",
      open: 9249,
      partyName: "Acme Inc.",
      partyIbans: [],
      currency: "USD",
    };
    const [match] = suggestMatches({ amount: 9180, bookingDate: "2026-09-20", counterpartyName: "ACME INC", counterpartyIban: null, purpose: "RE-2026-0042" }, [
      item,
    ]);
    expect(match).toMatchObject({ amount: 9180, exchangeDifference: -69 });
    expect(match!.reasons).toContain("Betrag passt bis auf eine Kursdifferenz (USD)");
    // In Euro gibt es keine Kursdifferenz
    const [euro] = suggestMatches({ amount: 9180, bookingDate: "2026-09-20", counterpartyName: "ACME INC", counterpartyIban: null, purpose: "RE-2026-0042" }, [
      { ...item, currency: "EUR" },
    ]);
    expect(euro!.exchangeDifference).toBeUndefined();
  });
});

describe("Lohnsteuer an das Finanzamt", () => {
  const anmeldungen = [
    { label: "Oktober 2026", betrag: 1_392_47 },
    { label: "November 2026", betrag: 1_400_00 },
  ];

  it("schlägt die Lastschrift des Finanzamts über den Gesamtbetrag einer übermittelten Anmeldung vor", () => {
    expect(suggestLohnsteuer({ amount: -1_392_47, counterpartyName: "Finanzamt München" }, anmeldungen)).toEqual({
      kind: "lohnsteuer",
      reasons: ["Gesamtbetrag (Kz 83) der Lohnsteuer-Anmeldung Oktober 2026"],
    });
  });

  it("nicht bei anderer Gegenpartei, anderem Betrag, Eingang oder mehrdeutigem Betrag", () => {
    expect(suggestLohnsteuer({ amount: -1_392_47, counterpartyName: "Erika Muster" }, anmeldungen)).toBeNull();
    expect(suggestLohnsteuer({ amount: -1_392_48, counterpartyName: "Finanzamt München" }, anmeldungen)).toBeNull();
    expect(suggestLohnsteuer({ amount: 1_392_47, counterpartyName: "Finanzamt München" }, anmeldungen)).toBeNull();
    expect(
      suggestLohnsteuer({ amount: -1_400_00, counterpartyName: "Finanzamt München" }, [...anmeldungen, { label: "Dezember 2026", betrag: 1_400_00 }]),
    ).toBeNull();
  });
});

describe("Bestellnummer im Verwendungszweck", () => {
  const rechnung = (number: string, date: string, order: string): OpenItem => ({
    type: "invoice",
    id: number,
    number,
    date,
    open: 2200,
    partyName: "Etsy Kunden USA",
    partyIbans: [],
    currency: "EUR",
    orderReferences: [order],
  });
  const items = [
    rechnung("2023-004", "2023-06-07", "1000000001"),
    rechnung("2023-005", "2023-06-23", "1000000003"),
    rechnung("2023-006", "2023-06-28", "1000000005"),
  ];
  const tx = (purpose: string, amount = 2200) => ({ bookingDate: "2023-06-28", amount, counterpartyName: "Etsy", purpose });

  it("entscheidet bei gleichem Betrag über die Bestellnummer", () => {
    const [best] = suggestMatches(tx("Sale · Payment for Order #1000000005"), items);
    expect(best?.item.number).toBe("2023-006");
    expect(best?.reasons).toContain("Bestellnummer im Verwendungszweck (1000000005)");
  });

  it("trifft keine Nummer, die nur der Anfang einer anderen ist", () => {
    const [best] = suggestMatches(tx("Sale · Payment for Order #10000000"), items);
    expect(best?.reasons.some((r) => r.startsWith("Bestellnummer"))).toBe(false);
  });

  it("zählt Nummern unter fünf Zeichen nicht, auch nicht mit Trennzeichen", () => {
    const kurz = [rechnung("2023-004", "2023-06-07", "#1234"), rechnung("2023-005", "2023-06-23", "A-1-2-3")];
    for (const purpose of ["Sale · Payment for Order 1234", "Sale · Payment for Order A123"]) {
      const best = suggestMatches(tx(purpose), kurz)[0];
      expect(best?.reasons.some((r) => r.startsWith("Bestellnummer")) ?? false).toBe(false);
    }
  });

  it("schlägt für eine Gebühr mit derselben Bestellnummer keine Rechnung vor", () => {
    expect(suggestMatches(tx("Gebühr · Transaction fee · Order #1000000005", -143), items)).toEqual([]);
  });

  // Fälle wie in einer Etsy-Abrechnung (erfundene Nummern): Dieselbe Bestellnummer steht auch bei Gutschriften und dem Karteneinzug
  // einer Erstattung, jeweils mit positivem Betrag und anderem Betrag als die Rechnung.
  const verkauf = (order: string, open: number): OpenItem => ({ ...rechnung("2023-007", "2023-06-14", order), open });
  it("gibt für eine Gebühren-Gutschrift mit positivem Betrag keine Bestellnummer-Punkte", () => {
    const gutschrift = tx("Gebühr · Credit for transaction fee · Order #1000000002", 131);
    expect(suggestMatches(gutschrift, [verkauf("1000000002", 2050)])).toEqual([]);
  });

  it("gibt für den Karteneinzug einer Erstattung keine Bestellnummer-Punkte", () => {
    const einzug = tx("Zahlung · Gebühr für Rückerstattung 1000000002", 1950);
    expect(suggestMatches(einzug, [verkauf("1000000002", 2050)])).toEqual([]);
  });

  it("zählt die Bestellnummer erst mit exaktem Betrag, auch bei sonst gleicher Nummer", () => {
    const rechnungen = [verkauf("1000000002", 2050), { ...verkauf("1000000004", 2050), id: "2023-008", number: "2023-008" }];
    const [best] = suggestMatches(tx("Sale · Payment for Order #1000000004", 2050), rechnungen);
    expect(best?.item.number).toBe("2023-008");
    expect(best?.reasons).toContain("Bestellnummer im Verwendungszweck (1000000004)");
  });
});

describe("Bestellnummer bei Erstattungen", () => {
  it("findet für eine Erstattung das Storno mit derselben Bestellnummer", () => {
    const storno: OpenItem = {
      type: "invoice",
      id: "st",
      number: "2023-009",
      date: "2023-07-01",
      open: -2200,
      partyName: "Jane Doe",
      partyIbans: [],
      currency: "EUR",
      orderReferences: ["1000000005"],
    };
    const anderes: OpenItem = { ...storno, id: "st2", number: "2023-010", orderReferences: ["1000000001"] };
    const [best] = suggestMatches(
      { bookingDate: "2023-07-02", amount: -2200, counterpartyName: "Etsy", purpose: "Erstattung · Refund to buyer for Order #1000000005" },
      [anderes, storno],
    );
    expect(best?.item.number).toBe("2023-009");
    expect(best?.reasons).toContain("Bestellnummer im Verwendungszweck (1000000005)");
  });
});
