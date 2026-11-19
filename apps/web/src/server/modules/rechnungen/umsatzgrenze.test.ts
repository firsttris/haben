import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../../db/index.ts";
import { today } from "../../today.ts";
import { pruefeUmsatzgrenze, type UmsatzStand, UmsatzgrenzeError } from "./umsatzgrenze.ts";

/*
 * Den vereinnahmten Umsatz rechnet `auswertungen`, das über `rechnungen` steht (#1108). Wer festschreibt, übergibt die
 * Rechnung dafür; `rechnungen` hält keinen Zustand, der in einer zweiten Kopie des Moduls fehlen könnte.
 */

const tx = {} as Tx;
const rechnung = { kind: "rechnung" as const, issueDate: today(), taxTreatment: "kleinunternehmer" as const };
const stand: UmsatzStand = async () => ({
  aktuell: { netto: 2_400_000 },
  vorjahr: { netto: 0 },
  jahresgrenze: 2_500_000,
  vorjahresgrenzeUeberschritten: false,
});

describe("Kleinunternehmergrenze beim Festschreiben", () => {
  it("fragt mit dem übergebenen Umsatz zurück", async () => {
    await expect(pruefeUmsatzgrenze(tx, rechnung, 50_000, null, stand)).resolves.toBeUndefined();
    await expect(pruefeUmsatzgrenze(tx, rechnung, 200_000, null, stand)).rejects.toThrow(UmsatzgrenzeError);
    const bestaetigt = { umsatz: 2_400_000, rechnung: 200_000, grenze: 2_500_000, vorjahresumsatz: undefined };
    await expect(pruefeUmsatzgrenze(tx, rechnung, 200_000, null, stand, bestaetigt)).resolves.toBeUndefined();
  });

  it("fragt den Umsatz nicht ab, wo es keine Rückfrage gibt", async () => {
    const nieGefragt = vi.fn(stand);
    await expect(pruefeUmsatzgrenze(tx, { ...rechnung, taxTreatment: "regulaer" }, 200_000, null, nieGefragt)).resolves.toBeUndefined();
    expect(nieGefragt).not.toHaveBeenCalled();
  });

  // Im Build bündelt Nitro Plugins und Server Functions getrennt, jedes mit einer eigenen Kopie dieses Moduls; ein beim
  // Start belegter Zustand fehlte deshalb beim Festschreiben aus der Oberfläche (E2E fremdrechnung-kleinunternehmer)
  it("rechnet in jeder Kopie des Moduls gleich", async () => {
    vi.resetModules();
    const kopie = await import("./umsatzgrenze.ts");
    await expect(kopie.pruefeUmsatzgrenze(tx, rechnung, 200_000, null, stand)).rejects.toThrow(kopie.UmsatzgrenzeError);
  });
});
