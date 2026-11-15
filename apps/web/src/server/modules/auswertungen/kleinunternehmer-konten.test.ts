import { ACCOUNTS, KLEINUNTERNEHMER_FRUEHERE_KONTEN } from "@haben/core";
import { describe, expect, it } from "vitest";
import { kleinunternehmerKonten } from "./kleinunternehmer-konten.ts";
import { JAHRESGRENZE, umsatzgrenzeNahe, VORJAHRESGRENZE } from "../../../lib/kleinunternehmer.ts";

describe("Umsatzgrenzen für Kleinunternehmer", () => {
  it.each([VORJAHRESGRENZE, JAHRESGRENZE])("warnt ab 80 %% von %s Cent", (grenze) => {
    const warnung = grenze * 0.8;
    expect(umsatzgrenzeNahe(warnung - 1, grenze)).toBe(false);
    expect(umsatzgrenzeNahe(warnung, grenze)).toBe(true);
  });

  it.each(["SKR03", "SKR04"] as const)("zählt in %s steuerbare Nettoerlöse und ihre Gegenbuchungen", (kr) => {
    const a = ACCOUNTS[kr];
    const zeile = (account: string, saldo: number) => ({ account, debit: Math.max(0, -saldo), credit: Math.max(0, saldo), taxCode: null });
    expect(
      kleinunternehmerKonten(kr, [
        zeile(a.erloese[1900], 100),
        zeile(a.ust[1900], 19),
        zeile(a.erloeseSonder.kleinunternehmer, 100),
        zeile(a.erloeseSonder.kleinunternehmer, -50),
        zeile(KLEINUNTERNEHMER_FRUEHERE_KONTEN[kr], 10),
        zeile(a.erloeseSonder.ausfuhr, 100),
        zeile(a.erloeseSonder.ig_lieferung, 100),
        zeile(a.erloeseSonder.reverse_charge, 100),
        zeile(a.erloeseSonder.drittland, 100),
        zeile(a.erloeseSonder.steuerfrei, 100),
        zeile(a.mahnerloes, 100),
        zeile(a.saldenvortrag, 100),
      ]),
    ).toEqual({ netto: 360, steuerfrei: true });
  });
});
