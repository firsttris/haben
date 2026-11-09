import { describe, expect, it } from "vitest";
import { buildDatevBuchungsstapel, type DatevExportEntry } from "./datev-export.ts";
import { personenkontenEinsetzen, type PersonenkontoBezug } from "./datev-personenkonten.ts";

const SAMMELKONTEN = { SKR03: { forderungen: "1400", verbindlichkeiten: "1600" }, SKR04: { forderungen: "1200", verbindlichkeiten: "3300" } } as const;
const KONTEN = {
  SKR03: { erloese: "8400", ust: "1776", bank: "1200", aufwand: "4930", vorsteuer: "1576", skonto: "8730" },
  SKR04: { erloese: "4400", ust: "3806", bank: "1800", aufwand: "6815", vorsteuer: "1406", skonto: "4730" },
} as const;

const partner = { name: "Musterpartner GmbH", debitorNr: 10042, kreditorNr: 70087 };
const rechnung: PersonenkontoBezug = { vorgang: "Rechnung RE-2026-0001", rolle: "debitor", kontakt: { name: partner.name, nummer: partner.debitorNr } };
const beleg: PersonenkontoBezug = { vorgang: "Beleg ER-77", rolle: "kreditor", kontakt: { name: partner.name, nummer: partner.kreditorNr } };

const entry = (
  description: string,
  lines: [string, number, number][],
  bezug: PersonenkontoBezug | null,
): DatevExportEntry & { bezug: PersonenkontoBezug | null } => ({
  date: "2026-09-01",
  description,
  voucher: "RE-2026-0001",
  locked: true,
  lines: lines.map(([account, debit, credit]) => ({ account, debit, credit })),
  bezug,
});

describe.each(["SKR03", "SKR04"] as const)("Personenkonten im Buchungsstapel, %s", (kr) => {
  const s = SAMMELKONTEN[kr];
  const k = KONTEN[kr];
  // Ein Kontakt mit beiden Rollen: Rechnung, Zahlung, Skonto und Storno beim Debitor, Beleg, Zahlung und Gutschrift beim Kreditor
  const journal = [
    entry(
      "Rechnung",
      [
        [s.forderungen, 119_00, 0],
        [k.erloese, 0, 100_00],
        [k.ust, 0, 19_00],
      ],
      rechnung,
    ),
    entry(
      "Zahlung Rechnung, Teil",
      [
        [k.bank, 50_00, 0],
        [s.forderungen, 0, 50_00],
      ],
      rechnung,
    ),
    entry(
      "Skonto",
      [
        [k.skonto, 2_00, 0],
        [s.forderungen, 0, 2_00],
      ],
      rechnung,
    ),
    entry(
      "Rückzahlung an den Kunden",
      [
        [s.forderungen, 10_00, 0],
        [k.bank, 0, 10_00],
      ],
      rechnung,
    ),
    entry(
      "Beleg",
      [
        [k.aufwand, 100_00, 0],
        [k.vorsteuer, 19_00, 0],
        [s.verbindlichkeiten, 0, 119_00],
      ],
      beleg,
    ),
    entry(
      "Zahlung Beleg",
      [
        [s.verbindlichkeiten, 119_00, 0],
        [k.bank, 0, 119_00],
      ],
      beleg,
    ),
    entry(
      "Erstattung des Lieferanten",
      [
        [k.bank, 5_00, 0],
        [s.verbindlichkeiten, 0, 5_00],
      ],
      beleg,
    ),
  ];

  it("setzt Debitor bzw. Kreditor nach der Herkunft des Vorgangs ein, nicht nach dem Vorzeichen", () => {
    const result = personenkontenEinsetzen(journal, s);
    if (!("entries" in result)) throw new Error(result.probleme.join("\n"));
    const accounts = result.entries.map((e) => e.lines.map((l) => l.account));
    expect(accounts).toEqual([
      ["10042", k.erloese, k.ust],
      [k.bank, "10042"],
      [k.skonto, "10042"],
      ["10042", k.bank],
      [k.aufwand, k.vorsteuer, "70087"],
      ["70087", k.bank],
      [k.bank, "70087"],
    ]);
    expect(result.verwendet).toEqual([
      { rolle: "debitor", nummer: 10042 },
      { rolle: "kreditor", nummer: 70087 },
    ]);
  });

  it("liefert jeden Betrag nur einmal: Summe der Personenkonten gleich dem Saldo des Sammelkontos, das Sammelkonto fehlt", () => {
    const result = personenkontenEinsetzen(journal, s);
    if (!("entries" in result)) throw new Error("abgelehnt");
    const { rows } = buildDatevBuchungsstapel(
      {
        beraterNr: "29098",
        mandantNr: "55003",
        fiscalYearStart: "2026-01-01",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        description: "x",
        kontenrahmen: kr,
        createdAt: new Date(2026, 0, 1),
      },
      result.entries,
    );
    const saldo = (account: string) => rows.reduce((sum, r) => sum + (r.account === account ? r.amount : 0) - (r.contraAccount === account ? r.amount : 0), 0);
    const journalSaldo = (account: string) => journal.flatMap((e) => e.lines).reduce((sum, l) => sum + (l.account === account ? l.debit - l.credit : 0), 0);
    expect(saldo("10042")).toBe(journalSaldo(s.forderungen));
    expect(saldo("70087")).toBe(journalSaldo(s.verbindlichkeiten));
    expect(rows.some((r) => [r.account, r.contraAccount].includes(s.forderungen) || [r.account, r.contraAccount].includes(s.verbindlichkeiten))).toBe(false);
  });

  it("lässt Buchungen ohne Sammelkonto unverändert, auch ohne Bezug", () => {
    const privat = entry(
      "Privateinlage",
      [
        [k.bank, 100_00, 0],
        [kr === "SKR03" ? "1890" : "2180", 0, 100_00],
      ],
      null,
    );
    const result = personenkontenEinsetzen([privat], s);
    expect(result).toEqual({ entries: [privat], verwendet: [] });
  });

  it("lehnt ab, wenn Kontakt oder Nummer fehlt, mit je einer Zeile je Vorgang, statt auf das Sammelkonto zu buchen", () => {
    const ohneKunde: PersonenkontoBezug = { vorgang: "Rechnung RE-2026-0002", rolle: "debitor", kontakt: null };
    const ohneLieferant: PersonenkontoBezug = { vorgang: "Beleg „hetzner.pdf“", rolle: "kreditor", kontakt: null };
    const ohneNummer: PersonenkontoBezug = { vorgang: "Beleg ER-78", rolle: "kreditor", kontakt: { name: "Papierwerk Süd AG", nummer: null } };
    const result = personenkontenEinsetzen(
      [
        entry(
          "Rechnung 2",
          [
            [s.forderungen, 10_00, 0],
            [k.erloese, 0, 10_00],
          ],
          ohneKunde,
        ),
        entry(
          "Zahlung Rechnung 2",
          [
            [k.bank, 10_00, 0],
            [s.forderungen, 0, 10_00],
          ],
          ohneKunde,
        ),
        entry(
          "Beleg Hetzner",
          [
            [k.aufwand, 10_00, 0],
            [s.verbindlichkeiten, 0, 10_00],
          ],
          ohneLieferant,
        ),
        entry(
          "Beleg Papier",
          [
            [k.aufwand, 10_00, 0],
            [s.verbindlichkeiten, 0, 10_00],
          ],
          ohneNummer,
        ),
        entry(
          "Unbekannt",
          [
            [k.bank, 10_00, 0],
            [s.forderungen, 0, 10_00],
          ],
          null,
        ),
        ...journal,
      ],
      s,
    );
    expect(result).toEqual({
      probleme: [
        "Rechnung RE-2026-0002: ohne Kunden aus den Kontakten",
        "Beleg „hetzner.pdf“: ohne Lieferanten aus den Kontakten",
        "Beleg ER-78: „Papierwerk Süd AG“ hat keinen Kreditor",
        `Buchung vom 01.09.2026 „Unbekannt“: Konto ${s.forderungen} ohne Rechnung`,
      ],
    });
  });

  it("lässt Eröffnungsbuchungen auf dem Sammelkonto, ohne abzulehnen (Restsaldo aus der Vorgänger-Buchhaltung)", () => {
    const eroeffnung = {
      ...entry(
        "Eröffnung aus der Schlussbilanz",
        [
          [s.forderungen, 500_00, 0],
          [s.verbindlichkeiten, 0, 300_00],
          ["9000", 0, 200_00],
        ],
        null,
      ),
      eroeffnung: true,
    };
    const result = personenkontenEinsetzen([eroeffnung, ...journal], s);
    if (!("entries" in result)) throw new Error(result.probleme.join("\n"));
    expect(result.entries[0]!.lines.map((l) => l.account)).toEqual([s.forderungen, s.verbindlichkeiten, "9000"]);
    // Die übrigen Buchungen bekommen weiter ihr Personenkonto
    expect(result.entries[1]!.lines[0]!.account).toBe("10042");
  });

  it("lässt Buchung und Storno ohne Personenkonto auch über die Jahresgrenze auf dem Sammelkonto (#452)", () => {
    const ohneLieferant = (description: string, credit: boolean) =>
      entry(
        description,
        [
          [s.verbindlichkeiten, credit ? 0 : 119_00, credit ? 119_00 : 0],
          ["4930", credit ? 119_00 : 0, credit ? 0 : 119_00],
        ],
        { vorgang: "Beleg ER-1", rolle: "kreditor", kontakt: null },
      );
    // Im Jahr des Belegs: die Gegenbuchung steht im Folgejahr
    const original = { ...ohneLieferant("Beleg", true), id: "a", storniert: true };
    expect(personenkontenEinsetzen([original], s)).toMatchObject({ verwendet: [] });
    // Im Folgejahr: das Original steht im Vorjahr
    const storno = { ...ohneLieferant("Storno: Beleg", false), id: "b", reversesId: "a" };
    expect(personenkontenEinsetzen([storno], s)).toMatchObject({ verwendet: [] });
    // Ohne Storno bleibt die Ablehnung
    expect(personenkontenEinsetzen([{ ...original, storniert: false }], s)).toEqual({ probleme: ["Beleg ER-1: ohne Lieferanten aus den Kontakten"] });
  });

  it("lehnt eine Buchung ohne Vorgang auf dem Sammelkonto weiter ab, wenn sie keine Eröffnung ist", () => {
    const result = personenkontenEinsetzen(
      [
        entry(
          "Ohne Vorgang",
          [
            [s.forderungen, 500_00, 0],
            ["9000", 0, 500_00],
          ],
          null,
        ),
      ],
      s,
    );
    expect(result).toEqual({ probleme: [`Buchung vom 01.09.2026 „Ohne Vorgang“: Konto ${s.forderungen} ohne Rechnung`] });
  });

  it("lehnt ein Sammelkonto ab, das nicht zur Rolle des Vorgangs passt", () => {
    const result = personenkontenEinsetzen(
      [
        entry(
          "Seltsam",
          [
            [s.verbindlichkeiten, 10_00, 0],
            [k.bank, 0, 10_00],
          ],
          rechnung,
        ),
      ],
      s,
    );
    expect(result).toEqual({ probleme: [`Rechnung RE-2026-0001: Konto ${s.verbindlichkeiten} ohne Beleg`] });
  });
});
