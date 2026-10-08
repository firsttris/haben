import { describe, expect, it } from "vitest";
import { computeEuer, euerToCsv } from "./euer.ts";
import { kontenblattToCsv, kontenkennzahlen, kontenklasse, kontoart, saldenlisteToCsv, saldoAnzeige, saldoSeite } from "./ledger.ts";

describe("Konten", () => {
  it("ordnet Kontenklassen zu", () => {
    expect(kontenklasse("SKR03", "8400")).toBe("Erlöskonten");
    expect(kontenklasse("SKR03", "1200")).toBe("Finanz- und Privatkonten");
    expect(kontenklasse("SKR04", "6815")).toBe("Betriebliche Aufwendungen");
    expect(kontenklasse("SKR03", "5000")).toBe("Sonstige Konten");
  });

  it("zeigt die Saldoseite", () => {
    expect(saldoSeite(100)).toBe("S");
    expect(saldoSeite(-100)).toBe("H");
    expect(saldoSeite(0)).toBe("");
  });

  it("schreibt Saldenliste und Kontenblatt als CSV", () => {
    const saldenliste = saldenlisteToCsv([{ kontenrahmen: "SKR03", account: "8400", name: "Erlöse 19 % USt", eroeffnung: -10_000, soll: 0, haben: 50_000, saldo: -60_000 }]);
    expect(saldenliste.startsWith("﻿Konto;Bezeichnung;Kontenklasse")).toBe(true);
    expect(saldenliste).toContain("8400;Erlöse 19 % USt;Erlöskonten;100,00 H;0,00;500,00;600,00;H\r\n");
    const blatt = kontenblattToCsv(0, [{ date: "2026-01-05", description: "Rechnung; RE-1", gegenkonten: ["1200", "1776"], soll: 0, haben: 50_000, saldo: -50_000 }]);
    expect(blatt).toContain(';Eröffnung;;;;0,00;\r\n');
    expect(blatt).toContain('2026-01-05;"Rechnung; RE-1";1200, 1776;;500,00;500,00;H');
  });

  it("entschärft Formeln in Textfeldern, nicht in Beträgen", () => {
    const blatt = kontenblattToCsv(-500, [{ date: "2026-01-05", description: "=HYPERLINK(\"x\")", gegenkonten: ["@1200"], soll: 0, haben: 50_000, saldo: -50_000 }]);
    expect(blatt).toContain(';Eröffnung;;;;5,00;H\r\n');
    expect(blatt).toContain('2026-01-05;"\'=HYPERLINK(""x"")";\'@1200;;500,00;500,00;H');
    expect(euerToCsv({ ...computeEuer(2026, []), gewinn: -1_234 })).toContain("Ergebnis;Verlust;-12,34\r\n");
  });

  it("erkennt die Kontoart und zeigt Salden ohne Buchhaltungssprache", () => {
    expect(kontoart("SKR03", "8400")).toBe("ertrag");
    expect(kontoart("SKR03", "4930")).toBe("aufwand");
    expect(kontoart("SKR03", "1200")).toBe("bestand");
    expect(kontoart("SKR03", "2650", -100)).toBe("ertrag");
    expect(kontoart("SKR04", "6815")).toBe("aufwand");
    expect(kontoart("SKR04", "4400")).toBe("ertrag");
    expect(saldoAnzeige("SKR03", "8400", -50_000)).toEqual({ betrag: 50_000, hinweis: "" });
    expect(saldoAnzeige("SKR03", "4930", 1_000)).toEqual({ betrag: 1_000, hinweis: "" });
    expect(saldoAnzeige("SKR03", "1200", 9_000)).toEqual({ betrag: 9_000, hinweis: "Guthaben" });
    expect(saldoAnzeige("SKR03", "1776", -1_900)).toEqual({ betrag: 1_900, hinweis: "Schuld" });
  });

  it("rechnet Kennzahlen für die Kacheln", () => {
    const row = (account: string, soll: number, haben: number) => ({ kontenrahmen: "SKR03" as const, account, name: "", eroeffnung: 0, soll, haben, saldo: soll - haben });
    const k = kontenkennzahlen([
      row("1200", 119_000, 5_950),
      row("1400", 119_000, 119_000),
      row("1600", 5_950, 11_900),
      row("1776", 0, 19_000),
      row("1576", 950, 0),
      row("1780", 10_000, 0),
      row("1766", 19_000, 19_000),
      row("4930", 5_000, 0),
      row("8400", 0, 100_000),
    ]);
    expect(k).toEqual({ bank: 113_050, forderungen: 0, verbindlichkeiten: 5_950, umsatzsteuer: 19_000 - 950 - 10_000, ertraege: 100_000, aufwand: 5_000 });
  });
});
