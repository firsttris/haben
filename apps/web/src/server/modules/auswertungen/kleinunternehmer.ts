import { kleinunternehmerJahresgrenze, umsatzgrenzeNahe, VORJAHRESGRENZE } from "@haben/core";
import { db, type Db, type Tx } from "../../db/index.ts";
import { gesamtumsatzForYear } from "./gesamtumsatz.ts";

export async function vereinnahmterUmsatz(bis: string, q: Db | Tx = db) {
  // §19 Abs.2 UStG: Warnung und Jahresübersicht verwenden dieselben vereinnahmten Entgelte und Abzüge.
  // https://www.gesetze-im-internet.de/ustg_1980/__19.html
  const { included, complete } = await gesamtumsatzForYear(Number(bis.slice(0, 4)), q, bis);
  return { netto: included, ungeklaert: !complete };
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
