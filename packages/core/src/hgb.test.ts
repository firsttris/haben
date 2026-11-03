import { describe, expect, it } from "vitest";
import { ASSET_ACCOUNTS } from "./afa.ts";
import { abschluss, postenForSaldo, postenOf } from "./hgb.ts";
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
