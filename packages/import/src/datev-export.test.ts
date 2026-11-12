import { describe, expect, it } from "vitest";
import { buildDatevBuchungsstapel, DATEV_COLUMNS, encodeCp1252, splitEntry, type DatevExportEntry, type DatevExportHeader } from "./datev-export.ts";
import { parseDatevBuchungsstapel } from "./datev.ts";

const header: DatevExportHeader = {
  beraterNr: "1001",
  mandantNr: "12345",
  fiscalYearStart: "2026-01-01",
  dateFrom: "2026-01-01",
  dateTo: "2026-12-31",
  description: "Haben 2026",
  kontenrahmen: "SKR03",
  createdAt: new Date(2026, 9, 4, 12, 0, 0, 0),
};

// Rechnung (Ist-Versteuerung), Zahlungseingang mit Umbuchung der Steuer, Beleg mit Privatanteil
const entries: DatevExportEntry[] = [
  {
    date: "2026-09-01",
    description: "Rechnung 2026-001 · Nordwerk Software GmbH",
    voucher: "2026-001",
    locked: true,
    lines: [
      { account: "1400", debit: 119_000, credit: 0 },
      { account: "8400", debit: 0, credit: 100_000 },
      { account: "1766", debit: 0, credit: 19_000 },
    ],
  },
  {
    date: "2026-09-20",
    description: "Zahlung Rechnung 2026-001",
    voucher: "2026-001",
    locked: true,
    lines: [
      { account: "1200", debit: 119_000, credit: 0 },
      { account: "1400", debit: 0, credit: 119_000 },
      { account: "1766", debit: 19_000, credit: 0 },
      { account: "1776", debit: 0, credit: 19_000 },
    ],
  },
  {
    date: "2026-09-25",
    description: "Mobilfunk Funknetz, 20 % privat, Gerät",
    voucher: "MF-0815 / 9",
    locked: true,
    lines: [
      { account: "4920", debit: 3_200, credit: 0 },
      { account: "1576", debit: 608, credit: 0 },
      { account: "1800", debit: 952, credit: 0 },
      { account: "1600", debit: 0, credit: 4_760 },
    ],
  },
];

describe("DATEV-Buchungsstapel", () => {
  it("zerlegt Buchungen in Konto an Gegenkonto und setzt BU 40 auf Automatikkonten", () => {
    expect(splitEntry(entries[0]!, "SKR03").map((r) => [r.amount, r.account, r.contraAccount, r.buKey])).toEqual([
      [100_000, "1400", "8400", "40"],
      [19_000, "1400", "1766", ""],
    ]);
    expect(splitEntry(entries[2]!, "SKR03").map((r) => [r.amount, r.account, r.contraAccount])).toEqual([
      [3_200, "4920", "1600"],
      [952, "1800", "1600"],
      [608, "1576", "1600"],
    ]);
    expect(() => splitEntry({ ...entries[0]!, lines: [{ account: "1400", debit: 1, credit: 0 }] }, "SKR03")).toThrow(/nicht ausgeglichen/);
  });

  it("liest sich mit dem DATEV-Parser wieder ein, Salden je Konto wie im Journal", () => {
    const { bytes } = buildDatevBuchungsstapel(header, entries);
    const stack = parseDatevBuchungsstapel(bytes);
    expect(stack.warnings).toEqual([]);
    expect(stack.header).toMatchObject({ beraterNr: "1001", mandantNr: "12345", fiscalYearStart: "2026-01-01", kontenrahmen: "SKR03", accountLength: 4 });
    const saldo = new Map<string, number>();
    const add = (account: string, value: number) => saldo.set(account, (saldo.get(account) ?? 0) + value);
    for (const b of stack.bookings) {
      add(b.account, b.side === "S" ? b.amount : -b.amount);
      add(b.contraAccount, b.side === "S" ? -b.amount : b.amount);
    }
    const expected = new Map<string, number>();
    for (const e of entries) for (const l of e.lines) expected.set(l.account, (expected.get(l.account) ?? 0) + l.debit - l.credit);
    for (const [account, value] of expected) expect(saldo.get(account) ?? 0, account).toBe(value);
    const first = stack.bookings[0]!;
    expect(first).toMatchObject({ date: "2026-09-01", voucherField1: "2026-001", buKey: "40", text: "Rechnung 2026-001 · Nordwerk Software GmbH" });
    // Belegfeld 1 nur mit erlaubten Zeichen; Umlaute in Windows-1252
    expect(stack.bookings.at(-1)).toMatchObject({ voucherField1: "MF-0815/9", text: "Mobilfunk Funknetz, 20 % privat, Gerät" });
  });

  it("schreibt Formatversion 13 mit 125 Spalten in Kopf, Überschrift und jeder Zeile", () => {
    // Version 13 ergänzt nach „Land“ (Spalte 120) Abrechnungsreferenz bis Abw. Skontokonto
    expect(DATEV_COLUMNS.length).toBe(125);
    expect(DATEV_COLUMNS.indexOf("Land")).toBe(119);
    expect(DATEV_COLUMNS.at(-1)).toBe("Abw. Skontokonto");
    const lines = new TextDecoder("windows-1252").decode(buildDatevBuchungsstapel(header, entries).bytes).split("\r\n").filter(Boolean);
    expect(lines[0]!.split(";").slice(0, 5)).toEqual(['"EXTF"', "700", "21", '"Buchungsstapel"', "13"]);
    for (const line of lines.slice(1)) expect(line.split(";")).toHaveLength(125);
  });

  it("prüft Berater- und Mandantennummer und kodiert Windows-1252", () => {
    expect(() => buildDatevBuchungsstapel({ ...header, beraterNr: "" }, entries)).toThrow(/Beraternummer/);
    expect(() => buildDatevBuchungsstapel({ ...header, mandantNr: "123456" }, entries)).toThrow(/Mandantennummer/);
    expect([...encodeCp1252("Ä€„✓")]).toEqual([0xc4, 0x80, 0x84, 0x3f]);
  });
});

describe("Kopfzeile: Erzeugt am", () => {
  it("steht in deutscher Zeit, unabhängig von der Zeitzone des Prozesses", () => {
    const createdAt = new Date("2026-10-31T23:30:15.042Z");
    const [kopf] = new TextDecoder("windows-1252").decode(buildDatevBuchungsstapel({ ...header, createdAt }, entries).bytes).split("\r\n");
    expect(kopf!.split(";")[5]).toBe("20261101003015042");
  });
});

describe("Sachentnahme auf den Automatikkonten (#590)", () => {
  // DATEV SKR03 8910/8915, SKR04 4620/4610 „Entnahme durch den Unternehmer für Zwecke außerhalb des Unternehmens (Waren)“
  // sind AM-Konten (DATEV-Kontenrahmen SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175, gültig für 2026). Haben bucht die Umsatzsteuer als eigene Zeile; ohne BU 40 rechnete DATEV sie ein zweites Mal heraus.
  for (const [kr, privat, sach, ust] of [
    ["SKR03", "1800", "8910", "1776"],
    ["SKR03", "1800", "8915", "1771"],
    ["SKR04", "2100", "4620", "3806"],
    ["SKR04", "2100", "4610", "3801"],
    // Bis #598 die Sachentnahme 7 % in SKR04; ebenfalls ein AM-Konto („Verwendung von Gegenständen … 7 % USt“)
    ["SKR04", "2100", "4630", "3801"],
  ] as const) {
    it(`${kr} ${sach}: BU-Schlüssel 40`, () => {
      const rows = splitEntry(
        {
          date: "2026-09-10",
          description: "Sachentnahme",
          voucher: "",
          locked: true,
          lines: [
            { account: privat, debit: 11_900, credit: 0 },
            { account: sach, debit: 0, credit: 10_000 },
            { account: ust, debit: 0, credit: 1_900 },
          ],
        },
        kr,
      );
      expect(rows.find((r) => r.contraAccount === sach || r.account === sach)?.buKey).toBe("40");
    });
  }
});

describe("Private Kfz-Nutzung auf den Automatikkonten", () => {
  // DATEV SKR03 8921, SKR04 4645 „Verwendung von Gegenständen für Zwecke außerhalb des Unternehmens 19 % USt
  // (Fahrzeug-Nutzung)“ sind AM-Konten; 8924 bzw. 4639 „ohne USt“ sind KU-Konten ohne Errechnung der Umsatzsteuer
  // (DATEV-Kontenrahmen SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175, gültig für 2026)
  const entry = (privat: string, konto: string, ust: string | null) => ({
    date: "2026-09-30",
    description: "Private Kfz-Nutzung",
    voucher: "",
    locked: true,
    lines: [
      { account: privat, debit: ust ? 11_900 : 10_000, credit: 0 },
      { account: konto, debit: 0, credit: 10_000 },
      ...(ust ? [{ account: ust, debit: 0, credit: 1_900 }] : []),
    ],
  });
  for (const [kr, privat, konto, ust] of [
    ["SKR03", "1800", "8921", "1776"],
    ["SKR04", "2100", "4645", "3806"],
  ] as const) {
    it(`${kr} ${konto} mit Umsatzsteuer: BU-Schlüssel 40`, () => {
      const rows = splitEntry(entry(privat, konto, ust), kr);
      expect(rows.find((r) => r.contraAccount === konto || r.account === konto)?.buKey).toBe("40");
    });
  }
  for (const [kr, privat, konto] of [
    ["SKR03", "1800", "8924"],
    ["SKR04", "2100", "4639"],
  ] as const) {
    it(`${kr} ${konto} ohne Umsatzsteuer: kein BU-Schlüssel`, () => {
      const rows = splitEntry(entry(privat, konto, null), kr);
      expect(rows.find((r) => r.contraAccount === konto || r.account === konto)?.buKey ?? "").toBe("");
    });
  }
});

describe("Belegfeld 1 im Zeichensatz von DATEV (#675)", () => {
  // DATEV „ASCII-Import: Feldbeschreibungen für Standardformate“, Dok.-Nr. 1003221, Stand 13.08.2026, Feld 11: Ziffern,
  // Buchstaben und $ & % * + - /; unzulässig sind „insbesondere Leerzeichen, Umlaute, Punkt, Komma, Semikolon und Doppelpunkt“
  const buchung = (voucher: string, description: string, date = "2026-09-01"): DatevExportEntry => ({
    date,
    description,
    voucher,
    locked: true,
    lines: [
      { account: "1400", debit: 11_900, credit: 0 },
      { account: "8400", debit: 0, credit: 11_900 },
    ],
  });
  const zahlung = (voucher: string): DatevExportEntry => ({
    date: "2026-09-20",
    description: `Zahlung ${voucher}`,
    voucher,
    locked: true,
    lines: [
      { account: "1200", debit: 11_900, credit: 0 },
      { account: "1400", debit: 0, credit: 11_900 },
    ],
  });
  const belegfelder = (list: DatevExportEntry[]) => parseDatevBuchungsstapel(buildDatevBuchungsstapel(header, list).bytes).bookings.map((b) => b.voucherField1);

  it("ersetzt den Punkt durch einen Bindestrich, in Rechnung und Zahlung gleich", () => {
    const list = [buchung("RE.2026.001", "Rechnung RE.2026.001"), zahlung("RE.2026.001")];
    expect(belegfelder(list)).toEqual(["RE-2026-001", "RE-2026-001"]);
    expect(buildDatevBuchungsstapel(header, list).warnings).toEqual([]);
  });

  it("entfernt Umlaute und Leerzeichen, ersetzt Punkte und kürzt danach auf 36 Zeichen", () => {
    const voucher = "RÜ.Müller 2026.0001.Nachzahlung.Grundsteuer";
    expect(belegfelder([buchung(voucher, "Rechnung"), zahlung(voucher)])).toEqual([
      "R-Mller2026-0001-Nachzahlung-Grundst",
      "R-Mller2026-0001-Nachzahlung-Grundst",
    ]);
  });

  it("lässt die erlaubten Sonderzeichen stehen", () => {
    expect(belegfelder([buchung("A$1&2%3*4+5-6/7", "Rechnung")])).toEqual(["A$1&2%3*4+5-6/7"]);
  });

  it("warnt, wenn zwei verschiedene Nummern dasselbe Belegfeld 1 ergeben", () => {
    const { warnings } = buildDatevBuchungsstapel(header, [buchung("RE.1", "Rechnung RE.1"), zahlung("RE.1"), buchung("RE-1", "Beleg RE-1")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("„RE.1“");
    expect(warnings[0]).toContain("„RE-1“");
  });

  it("warnt auch, wenn erst das Kürzen auf 36 Zeichen zwei Nummern gleich macht", () => {
    const lang = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const { warnings } = buildDatevBuchungsstapel(header, [buchung(`${lang}-1`, "Rechnung 1"), buchung(`${lang}-2`, "Rechnung 2")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`„${lang}-1“`);
    expect(warnings[0]).toContain(`„${lang}-2“`);
  });
});
