import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { abschluss, type Posten, postenForSaldo, postenOf } from "./hgb.ts";
import { PAUSCHALE_KONTEN } from "./pauschalen.ts";
import { ACCOUNTS, EXPENSE_CATEGORIES, paymentProviderAccount, type Kontenrahmen } from "./posting.ts";
import { PRIVATE_USE_ACCOUNTS } from "./private-use.ts";
import { carriesForward, VORTRAG_ACCOUNTS } from "./vortrag.ts";

/** Alle Konten, die Haben selbst bebucht */
function habenAccounts(kr: Kontenrahmen): string[] {
  const a = ACCOUNTS[kr];
  const flat = (value: unknown): string[] => (typeof value === "string" ? [value] : Object.values(value as object).flatMap(flat));
  return [
    ...flat(a).filter((account) => account !== a.saldenvortrag),
    ...Object.values(EXPENSE_CATEGORIES).map((c) => c[kr]),
    ...flat(ASSET_ACCOUNTS[kr]),
    ...Object.values(PAUSCHALE_KONTEN).map((p) => p[kr].konto),
    ...flat(PRIVATE_USE_ACCOUNTS[kr]),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => paymentProviderAccount(kr, i)),
    ...Object.values(VORTRAG_ACCOUNTS[kr]),
  ];
}

describe("Zuordnung zu Bilanz und GuV (§ 266, § 275 Abs. 5 HGB)", () => {
  it.each(["SKR03", "SKR04"] as const)("%s: jedes Konto, das Haben bebucht, hat einen Posten, Bestandskonten in der Bilanz", (kr) => {
    for (const account of habenAccounts(kr)) {
      const posten = postenOf(kr, account);
      expect(posten, account).not.toBeNull();
      expect(posten!.startsWith("aktiva.") || posten!.startsWith("passiva."), `${account} ${posten}`).toBe(carriesForward(kr, account));
    }
  });

  it.each([
    ["SKR03", "1200", "aktiva.B"],
    ["SKR03", "1400", "aktiva.B"],
    ["SKR03", "0320", "aktiva.A"],
    ["SKR03", "0730", "passiva.C"],
    ["SKR03", "0800", "passiva.A"],
    ["SKR03", "1600", "passiva.C"],
    ["SKR03", "8400", "umsatzerloese"],
    ["SKR03", "4930", "sonstigeAufwendungen"],
    ["SKR03", "4830", "abschreibungen"],
    ["SKR04", "1800", "aktiva.B"],
    ["SKR04", "0520", "aktiva.A"],
    ["SKR04", "2900", "passiva.A"],
    ["SKR04", "2970", "passiva.A"],
    ["SKR04", "3510", "passiva.C"],
    // DATEV: „Sonstige Verbindlichkeiten oder Sonstige Vermögensgegenstände“
    ["SKR04", "3806", "passiva.C"],
    // Wo DATEV 2026 von anderen Zuordnungen abweicht: unentgeltliche Wertabgaben sind sonstige Erträge, 4570 Umsatzerlöse,
    // bezogene Leistungen Materialaufwand, Anteile an verbundenen Unternehmen in Klasse 1 Umlaufvermögen
    ["SKR03", "8900", "sonstigeErtraege"],
    ["SKR04", "4570", "umsatzerloese"],
    ["SKR04", "5950", "materialaufwand"],
    ["SKR04", "1500", "aktiva.B"],
    ["SKR03", "3990", "materialaufwand"],
    ["SKR03", "1360", "aktiva.B"],
    ["SKR03", "1361", "aktiva.B"],
    ["SKR04", "4400", "umsatzerloese"],
    ["SKR04", "5900", "materialaufwand"],
    ["SKR04", "6220", "abschreibungen"],
    ["SKR04", "7600", "steuern"],
  ] as const)("%s %s → %s", (kr, account, posten) => {
    expect(postenOf(kr, account)).toBe(posten);
  });

  it.each([
    // [Kontenrahmen, Konto, Posten mit Soll-Saldo, Posten mit Haben-Saldo]
    ["SKR03", "1200", "aktiva.B", "passiva.C"],
    ["SKR03", "0730", "aktiva.B", "passiva.C"],
    ["SKR03", "1766", "aktiva.B", "passiva.B"],
    ["SKR03", "1776", "aktiva.B", "passiva.C"],
    ["SKR04", "1800", "aktiva.B", "passiva.C"],
    ["SKR04", "3510", "aktiva.B", "passiva.C"],
    ["SKR04", "3816", "aktiva.B", "passiva.B"],
    // Ohne zweiten Posten bleibt das Konto, wo es ist
    ["SKR04", "2900", "passiva.A", "passiva.A"],
    ["SKR04", "0520", "aktiva.A", "aktiva.A"],
  ] as const)("%s %s: Soll-Saldo → %s, Haben-Saldo → %s (DATEV „A oder B“)", (kr, account, soll, haben) => {
    expect(postenForSaldo(kr, account, 100)).toBe(soll);
    expect(postenForSaldo(kr, account, -100)).toBe(haben);
  });

  it("Klasse 9 und Lücken haben keinen Posten", () => {
    expect(postenOf("SKR04", "9000")).toBeNull();
    expect(postenOf("SKR04", "0001")).toBeNull();
    expect(postenOf("SKR03", "12")).toBeNull();
  });
});

describe("Abschluss einer Kleinst-GmbH", () => {
  it("Bilanz geht auf, das Jahresergebnis steht im Eigenkapital", () => {
    const a = abschluss("SKR04", [
      { account: "1800", saldo: 3_200_000 },
      { account: "2900", saldo: -2_500_000 },
      { account: "3510", saldo: -200_000 },
      { account: "4400", saldo: -1_000_000 },
      { account: "3806", saldo: -190_000 },
      { account: "6300", saldo: 690_000 },
      { account: "9000", saldo: 0 },
    ]);
    expect(a.guv).toMatchObject({ umsatzerloese: 1_000_000, sonstigeAufwendungen: 690_000 });
    expect(a.jahresergebnis).toBe(310_000);
    expect(a.bilanz).toMatchObject({ "aktiva.B": 3_200_000, "passiva.A": 2_810_000, "passiva.C": 390_000 });
    expect(a.aktiva).toBe(3_200_000);
    expect(a.passiva).toBe(3_200_000);
    expect(a.nichtZugeordnet).toEqual([]);
    expect(a.offeneVortraege).toEqual([]);
    expect(a.konten["passiva.C"]).toEqual([
      { account: "3510", saldo: -200_000 },
      { account: "3806", saldo: -190_000 },
    ]);
  });

  it("überzogene Bank unter den Verbindlichkeiten, Forderung gegen den Gesellschafter im Umlaufvermögen", () => {
    const a = abschluss("SKR03", [
      { account: "1200", saldo: -50_000 },
      { account: "0730", saldo: 80_000 },
      { account: "4900", saldo: 20_000 },
      { account: "0800", saldo: -50_000 },
    ]);
    expect(a.bilanz).toMatchObject({ "aktiva.B": 80_000, "passiva.C": 50_000, "passiva.A": 30_000 });
    expect(a.jahresergebnis).toBe(-20_000);
    expect(a.aktiva).toBe(a.passiva);
  });

  it("Verlust und alle GuV-Zeilen nach § 275 Abs. 5", () => {
    const a = abschluss("SKR04", [
      { account: "4400", saldo: -100_000 },
      { account: "4830", saldo: -1_000 },
      { account: "5900", saldo: 30_000 },
      { account: "6020", saldo: 50_000 },
      { account: "6220", saldo: 10_000 },
      { account: "6300", saldo: 20_000 },
      { account: "7600", saldo: 5_000 },
      { account: "1800", saldo: -14_000 },
    ]);
    expect(a.guv).toEqual({
      umsatzerloese: 100_000,
      sonstigeErtraege: 1_000,
      materialaufwand: 30_000,
      personalaufwand: 50_000,
      abschreibungen: 10_000,
      sonstigeAufwendungen: 20_000,
      steuern: 5_000,
    });
    expect(a.jahresergebnis).toBe(-14_000);
    expect(a.bilanz["passiva.A"]).toBe(-14_000);
    expect(a.bilanz["passiva.C"]).toBe(14_000);
  });

  it.each([
    // DATEV „A oder B“ auch in der GuV: bei umgekehrtem Saldo gilt der zweite Posten
    ["SKR03", "2146", -5_000, "sonstigeErtraege"],
    ["SKR03", "2686", 5_000, "sonstigeAufwendungen"],
    ["SKR04", "7144", 5_000, "sonstigeAufwendungen"],
    ["SKR04", "7364", -5_000, "sonstigeErtraege"],
  ] as const)("%s: Erfolgskonto %s mit umgekehrtem Saldo steht im zweiten GuV-Posten", (kr, account, saldo, posten) => {
    expect(postenForSaldo(kr, account, saldo)).toBe(posten);
    const a = abschluss(kr, [{ account, saldo }]);
    expect(a.guv[posten]).toBe(5_000);
    expect(a.konten[posten]).toEqual([{ account, saldo }]);
  });

  it("meldet offene Vorträge und Konten ohne Posten, statt sie still wegzulassen", () => {
    const a = abschluss("SKR04", [
      { account: "9000", saldo: -1_000 },
      // Ergebnisverwendung nach dem Jahresergebnis (§ 158 AktG): kein Posten der GuV nach § 275 Abs. 5
      { account: "7700", saldo: 1_000 },
    ]);
    expect(a.offeneVortraege).toEqual([{ account: "9000", saldo: -1_000 }]);
    expect(a.nichtZugeordnet).toEqual([{ account: "7700", saldo: 1_000 }]);
  });
});

/*
 * Kontenbereiche, die der DATEV-Kontenrahmen 2026 als „von -bis“ angibt (z. B. „3980 -89 Waren (Bestand)“): Jedes
 * Konto darin hat denselben Posten wie das erste. Die Liste sind die Bereiche, deren Ende die erzeugte Tabelle verfehlte.
 */
describe("Kontenbereiche „von -bis“ aus dem DATEV-Kontenrahmen", () => {
  it.each([
    ["SKR03", "0820", "0829"],
    ["SKR03", "0890", "0899"],
    ["SKR03", "0910", "0919"],
    ["SKR03", "0920", "0929"],
    ["SKR03", "1300", "1328"],
    ["SKR03", "1373", "1375"],
    ["SKR03", "1660", "1664"],
    ["SKR03", "1991", "1999"],
    ["SKR03", "2753", "2754"],
    ["SKR03", "3960", "3969"],
    ["SKR03", "3980", "3989"],
    ["SKR03", "4000", "4099"],
    ["SKR03", "8792", "8799"],
    ["SKR04", "0051", "0059"],
    ["SKR04", "0061", "0069"],
    ["SKR04", "0071", "0079"],
    ["SKR04", "0150", "0169"],
    ["SKR04", "1496", "1497"],
    ["SKR04", "2030", "2049"],
    ["SKR04", "2060", "2069"],
    ["SKR04", "2080", "2099"],
    ["SKR04", "2791", "2799"],
    ["SKR04", "3350", "3399"],
    ["SKR04", "4792", "4799"],
  ] as const)("%s %s bis %s: alle Konten im selben Posten", (kontenrahmen, von, bis) => {
    const posten = postenOf(kontenrahmen, von);
    expect(posten).not.toBeNull();
    for (let n = Number(von); n <= Number(bis); n++) {
      const account = String(n).padStart(4, "0");
      expect(postenOf(kontenrahmen, account), account).toBe(posten);
    }
  });
});

/*
 * Abgleich mit dem DATEV-Kontenrahmen 2026 (SKR03 Art.-Nr. 11174, SKR04 Art.-Nr. 11175), Konto für Konto: der Posten der
 * linken Spalte, verdichtet auf § 266 und § 275 Abs. 5 HGB. Soll und Haben sind die Posten bei Soll- bzw. Haben-Saldo
 * („A oder B“); null = ohne Posten (Ergebnisverwendung nach dem Jahresergebnis, § 158 AktG).
 */
describe("Posten aus dem DATEV-Kontenrahmen 2026", () => {
  it.each([
    // „Geleistete Anzahlungen“ unter „Immaterielle Vermögensgegenstände“ (§ 266 Abs. 2 A.I.4): Anlagevermögen
    ["SKR03", "0038", "aktiva.A", "aktiva.A", "SKR03 S. 1: Anzahlungen auf Geschäfts- oder Firmenwert"],
    ["SKR03", "0039", "aktiva.A", "aktiva.A", "SKR03 S. 1: Geleistete Anzahlungen auf immaterielle Vermögensgegenstände"],
    ["SKR04", "0170", "aktiva.A", "aktiva.A", "SKR04 S. 1: Geleistete Anzahlungen auf immaterielle Vermögensgegenstände"],
    ["SKR04", "0179", "aktiva.A", "aktiva.A", "SKR04 S. 1: Anzahlungen auf Geschäfts- oder Firmenwert"],
    // Ergebnisverwendung: steht nach dem Jahresergebnis, wie SKR03 2795 ff. und SKR04 7700 ff.
    ["SKR03", "2480", null, null, "SKR03 S. 15: Einstellungen in die Rücklage für Anteile an einem herrschenden … Unternehmen"],
    ["SKR03", "2481", null, null, "SKR03 S. 15: Einstellungen in andere Rücklagen"],
    ["SKR03", "2485", null, null, "SKR03 S. 15: Einstellungen in andere Ergebnisrücklagen"],
    ["SKR03", "2488", null, null, "SKR03 S. 15: Steuerliches Mehr-/Minderergebnis lfd. Jahr"],
    ["SKR03", "2489", null, null, "SKR03 S. 15: Steuerliches Mehr-/Minderergebnis lfd. Jahr"],
    ["SKR03", "2495", null, null, "SKR03 S. 16: Einstellungen in die Kapitalrücklage (vereinfachte Kapitalherabsetzung)"],
    ["SKR03", "2496", null, null, "SKR03 S. 16: Einstellungen in die gesetzliche Rücklage"],
    ["SKR03", "2497", null, null, "SKR03 S. 16: Einstellungen in satzungsmäßige Rücklagen"],
    ["SKR03", "2498", null, null, "SKR03 S. 16: Einstellungen in die Rücklage für Anteile an einem herrschenden … Unternehmen"],
    ["SKR03", "2499", null, null, "SKR03 S. 16: Einstellungen in andere Gewinnrücklagen"],
    ["SKR03", "2745", null, null, "SKR03 S. 17: Ertrag aus Kapitalherabsetzung (wie SKR04 7755)"],
    // „Auf Grund einer Gewinngemeinschaft … abgeführte Gewinne [oder Erträge aus Verlustübernahme]“: Aufwand
    ["SKR03", "2491", "sonstigeAufwendungen", "sonstigeErtraege", "SKR03 S. 15: … abgeführte Gewinne oder Erträge aus Verlustübernahme"],
    ["SKR03", "2492", "sonstigeAufwendungen", "sonstigeAufwendungen", "SKR03 S. 16: … abgeführte Gewinne"],
    ["SKR03", "2493", "sonstigeAufwendungen", "sonstigeErtraege", "SKR03 S. 16: … abgeführte Gewinne oder Erträge aus Verlustübernahme"],
    ["SKR03", "2494", "sonstigeAufwendungen", "sonstigeAufwendungen", "SKR03 S. 16: … abgeführte Gewinne"],
    ["SKR04", "7392", "sonstigeAufwendungen", "sonstigeAufwendungen", "SKR04 S. 28: … abgeführte Gewinne"],
    ["SKR04", "7394", "sonstigeAufwendungen", "sonstigeAufwendungen", "SKR04 S. 28: … abgeführte Gewinne"],
    ["SKR04", "7398", "sonstigeAufwendungen", "sonstigeErtraege", "SKR04 S. 28: … abgeführte Gewinne oder Erträge aus Verlustübernahme"],
    ["SKR04", "7399", "sonstigeAufwendungen", "sonstigeErtraege", "SKR04 S. 28: … abgeführte Gewinne oder Erträge aus Verlustübernahme"],
    // „Sonstige Vermögensgegenstände oder sonstige Verbindlichkeiten“ (wie SKR03 1500/1501)
    ["SKR04", "1310", "aktiva.B", "passiva.C", "SKR04 S. 4: Forderungen gegen Vorstandsmitglieder und Geschäftsführer"],
    ["SKR04", "1311", "aktiva.B", "passiva.C", "SKR04 S. 4: – Restlaufzeit bis 1 Jahr"],
    ["SKR04", "1315", "aktiva.B", "aktiva.B", "SKR04 S. 4: – Restlaufzeit größer 1 Jahr: Sonstige Vermögensgegenstände"],
    // „Erhaltene Anzahlungen auf Bestellungen (von Vorräten offen abgesetzt)“ (§ 268 Abs. 5 Satz 2 HGB): bei den Vorräten
    ["SKR03", "1722", "aktiva.B", "aktiva.B", "SKR03 S. 10: Erhaltene Anzahlungen auf Bestellungen (von Vorräten offen abgesetzt)"],
    ["SKR04", "1190", "aktiva.B", "aktiva.B", "SKR04 S. 3: Erhaltene Anzahlungen auf Bestellungen (von Vorräten offen abgesetzt)"],
  ] as [Kontenrahmen, string, Posten | null, Posten | null, string][])("%s %s: Soll → %s, Haben → %s (%s)", (kr, account, soll, haben) => {
    expect(postenForSaldo(kr, account, 100)).toBe(soll);
    expect(postenForSaldo(kr, account, -100)).toBe(haben);
  });
});
