import { describe, expect, it } from "vitest";
import type { Tx } from "../../db/index.ts";
import { today } from "../../today.ts";
import { belegeUmsatzStand, pruefeUmsatzgrenze, UmsatzgrenzeError } from "./umsatzgrenze.ts";

/*
 * Die Stelle für den vereinnahmten Umsatz (#1108): `rechnungen` rechnet ihn nicht selbst, sondern bekommt ihn beim Start
 * von `auswertungen` (server/plugins/umsatzgrenze.ts). Fehlt sie, darf die Rückfrage nicht still entfallen.
 */

const tx = {} as Tx;
const rechnung = { kind: "rechnung" as const, issueDate: today(), taxTreatment: "kleinunternehmer" as const };

describe("Kleinunternehmergrenze beim Festschreiben", () => {
  it("bricht ohne belegte Stelle ab, statt die Rückfrage auszulassen", async () => {
    await expect(pruefeUmsatzgrenze(tx, rechnung, 1000, null)).rejects.toThrow(/nicht eingerichtet/);
  });

  it("braucht die Stelle nicht, wo es keine Rückfrage gibt", async () => {
    await expect(pruefeUmsatzgrenze(tx, { ...rechnung, taxTreatment: "regulaer" }, 1000, null)).resolves.toBeUndefined();
  });

  it("fragt mit dem Umsatz aus der belegten Stelle zurück", async () => {
    const stand = { aktuell: { netto: 2_400_000 }, vorjahr: { netto: 0 }, jahresgrenze: 2_500_000, vorjahresgrenzeUeberschritten: false };
    belegeUmsatzStand(async () => stand);
    await expect(pruefeUmsatzgrenze(tx, rechnung, 50_000, null)).resolves.toBeUndefined();
    await expect(pruefeUmsatzgrenze(tx, rechnung, 200_000, null)).rejects.toThrow(UmsatzgrenzeError);
    await expect(
      pruefeUmsatzgrenze(tx, rechnung, 200_000, null, { umsatz: 2_400_000, rechnung: 200_000, grenze: 2_500_000, vorjahresumsatz: undefined }),
    ).resolves.toBeUndefined();
  });
});
