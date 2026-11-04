import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alsText, type Dezimal } from "./dezimal.ts";
import { PAP_2026 } from "./pap-2026.ts";

/**
 * Gleicht die Jahreswerte in `pap-2026.ts` mit dem amtlichen PAP-XML daneben ab. Ändert der BMF Werte oder
 * Reihenfolge in einer Methode, schlägt der Test fehl, statt dass Haben mit abgeschriebenen Zahlen rechnet.
 */
const xml = readFileSync(new URL(PAP_2026.quelle.datei, import.meta.url));
const text = xml.toString("utf8");

/** Alle `BigDecimal.valueOf(…)`-Zahlen einer Methode in ihrer Reihenfolge */
function zahlenIn(methode: string): string[] {
  const block = new RegExp(`<METHOD name="${methode}">([\\s\\S]*?)</METHOD>`).exec(text)?.[1];
  if (!block) throw new Error(`Methode ${methode} fehlt im PAP`);
  return [...block.matchAll(/BigDecimal\.valueOf\(\s*([\d.]+)\s*\)/g)].map((treffer) => treffer[1]!);
}

const p = PAP_2026;
const t = (...werte: Dezimal[]) => werte.map(alsText);

describe("PAP 2026 gegen das amtliche XML", () => {
  it("ist die Datei, aus der übertragen wurde", () => {
    expect(createHash("sha256").update(xml).digest("hex")).toBe(p.quelle.sha256);
    expect(text).toContain(`<PAP name="Lohnsteuer2026" version="${p.quelle.version}"`);
    expect(text).toContain(`Stand: ${p.quelle.stand}`);
  });

  it("MPARA: Beitragsbemessungsgrenzen, Beitragssätze, Grenzwerte Steuerklasse V/VI, Grundfreibetrag, Soli-Freigrenze", () => {
    expect(zahlenIn("MPARA")).toEqual(
      t(
        p.BBGRVALV,
        p.AVSATZAN,
        p.RVSATZAN,
        p.BBGKVPV,
        p.kvSatzAnOhneZusatz,
        p.pvSatzAnSachsen,
        p.pvSatzAn,
        p.pvZuschlagKinderlos,
        p.pvAbschlagJeKind,
        p.W1STKL5,
        p.W2STKL5,
        p.W3STKL5,
        p.GFB,
        p.SOLZFREI,
      ),
    );
  });

  it("MZTABFB: Pauschbeträge, Entlastungsbetrag und Freibeträge für Kinder", () => {
    const [anp, sap, efa, kfb, halb] = t(p.arbeitnehmerPauschbetrag, p.SAP, p.EFA, p.kinderfreibetrag, p.kinderfreibetragHalb);
    // Die beiden 102 € sind der Werbungskosten-Pauschbetrag für Versorgungsbezüge, die Haben nicht rechnet
    expect(zahlenIn("MZTABFB")).toEqual(["102", "102", anp, anp, sap, kfb, efa, sap, kfb, sap, kfb, sap, halb, sap]);
  });

  it("MVSPHB, UPTAB26, MST5_6, UP5_6 und MSOLZ", () => {
    expect(zahlenIn("MVSPHB")).toEqual(t(p.hoechstbetragVorsorge, p.hoechstbetragVorsorge));
    expect(zahlenIn("UPTAB26")).toEqual(t(p.zone2Bis, ...p.zone2, p.zone3Bis, p.zone3Ab, ...p.zone3, p.zone4Bis, ...p.zone4, ...p.zone5));
    expect(zahlenIn("MST5_6")).toEqual(t(p.stkl5Satz42, p.stkl5Satz45, p.stkl5Satz42, p.stkl5Satz42));
    expect(zahlenIn("UP5_6")).toEqual(t(p.stkl5Oben, p.stkl5Unten, p.stkl5Mindest));
    expect(zahlenIn("MSOLZ")).toEqual(t(p.solzSatz, p.solzMilderung));
  });
});
