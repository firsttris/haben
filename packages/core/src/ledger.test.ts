import { describe, expect, it } from "vitest";
import { kontenblattToCsv, kontenklasse, saldenlisteToCsv, saldoSeite } from "./ledger.ts";

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
});
