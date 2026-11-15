import { kleinunternehmerJahresgrenze, umsatzgrenzeNahe, VORJAHRESGRENZE } from "@haben/core";
import { db, type Db, type Tx } from "../../db/index.ts";
import { euerAusJournal } from "./euer-journal.ts";

export async function vereinnahmterUmsatz(bis: string, q: Db | Tx = db) {
  const { kleinunternehmerUmsatz, ungeklaerteImporte } = await euerAusJournal(Number(bis.slice(0, 4)), q, bis);
  return { netto: kleinunternehmerUmsatz.netto, ungeklaert: kleinunternehmerUmsatz.steuerfrei || ungeklaerteImporte > 0 };
}

export async function kleinunternehmerStand(heute: string, foundedOn: string | null, q: Db | Tx = db) {
  const jahr = Number(heute.slice(0, 4));
  const { gruendungsjahr, jahresgrenze } = kleinunternehmerJahresgrenze(heute, foundedOn);
  const [aktuell, vorjahr] = await Promise.all([
    vereinnahmterUmsatz(heute, q),
    gruendungsjahr ? { netto: 0, ungeklaert: false } : vereinnahmterUmsatz(`${jahr - 1}-12-31`, q),
  ]);
  return {
    jahr,
    gruendungsjahr,
    aktuell,
    vorjahr,
    naheAktuell: umsatzgrenzeNahe(aktuell.netto, jahresgrenze),
    vorjahresgrenzeUeberschritten: !gruendungsjahr && vorjahr.netto > VORJAHRESGRENZE,
    jahresgrenze,
    vorjahresgrenze: VORJAHRESGRENZE,
  };
}
