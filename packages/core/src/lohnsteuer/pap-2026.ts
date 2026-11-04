import { dez } from "./dezimal.ts";
import type { PapJahr } from "./pap.ts";

/**
 * Jahreswerte des Programmablaufplans 2026 für die maschinelle Berechnung der Lohnsteuer.
 *
 * Quelle: amtliches PAP-XML `Lohnsteuer2026.xml` des BMF-Steuerrechners
 * (https://www.bmf-steuerrechner.de/javax.faces.resource/daten/xmls/Lohnsteuer2026.xml.xhtml),
 * `<PAP name="Lohnsteuer2026" version="1.0" versionNummer="1.0">`, „Stand: 2025-10-23 12:40, ITZBund Berlin“,
 * bekannt gemacht mit BMF-Schreiben vom 12.11.2025. Die Datei liegt unverändert daneben; als amtliches Werk
 * (§ 5 UrhG) ist sie frei. Am 04.11.2026 beim BMF unter der URL oben abgerufen: byte-gleich mit der Datei hier,
 * SHA-256 unten. `pap-2026.test.ts` gleicht jeden Wert hier mit dem XML ab.
 *
 * Die Kommentare nennen die Methode im PAP, in der der Wert steht.
 */
export const PAP_2026: PapJahr = {
  jahr: 2026,
  quelle: {
    datei: "Lohnsteuer2026.xml",
    version: "1.0",
    stand: "2025-10-23 12:40",
    sha256: "63d8981646d139eba2f4dd990c13b43c4fb3883b402a5a40cddf253aa7aa96b4",
  },
  // MPARA
  BBGRVALV: dez("101400"),
  AVSATZAN: dez("0.013"),
  RVSATZAN: dez("0.093"),
  BBGKVPV: dez("69750"),
  kvSatzAnOhneZusatz: dez("0.07"),
  pvSatzAn: dez("0.018"),
  pvSatzAnSachsen: dez("0.023"),
  pvZuschlagKinderlos: dez("0.006"),
  pvAbschlagJeKind: dez("0.0025"),
  W1STKL5: dez("14071"),
  W2STKL5: dez("34939"),
  W3STKL5: dez("222260"),
  GFB: dez("12348"),
  SOLZFREI: dez("20350"),
  // MZTABFB
  arbeitnehmerPauschbetrag: dez("1230"),
  SAP: dez("36"),
  EFA: dez("4260"),
  kinderfreibetrag: dez("9756"),
  kinderfreibetragHalb: dez("4878"),
  // MVSPHB
  hoechstbetragVorsorge: dez("1900"),
  // UPTAB26: Zonen des § 32a Abs. 1 EStG
  zone2Bis: dez("17800"),
  zone2: [dez("914.51"), dez("1400")],
  zone3Bis: dez("69879"),
  zone3Ab: dez("17799"),
  zone3: [dez("173.1"), dez("2397"), dez("1034.87")],
  zone4Bis: dez("277826"),
  zone4: [dez("0.42"), dez("11135.63")],
  zone5: [dez("0.45"), dez("19470.38")],
  // MST5_6 und UP5_6
  stkl5Satz42: dez("0.42"),
  stkl5Satz45: dez("0.45"),
  stkl5Oben: dez("1.25"),
  stkl5Unten: dez("0.75"),
  stkl5Mindest: dez("0.14"),
  // MSOLZ
  solzSatz: dez("5.5"),
  solzMilderung: dez("11.9"),
};
