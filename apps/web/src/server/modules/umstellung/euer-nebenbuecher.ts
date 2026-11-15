import {
  computeEuer,
  euerAusZeilen,
  euerErgebnis,
  isKapitalgesellschaft,
  leereEuerAusJournal,
  type Cents,
  type EuerLineKey,
  type EuerResult,
} from "@haben/core";
import { and, eq, gte, lt } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { buchungen } from "../auswertungen/index.ts";
import { depreciationForEuer, withdrawalsForEuer } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { euerPayments } from "./euer-zahlungen.ts";

/*
 * EINGEFROREN, nur für die Prüfung beim Update (#1116, pruefung.ts): die EÜR aus den Nebenbüchern, wie Haben sie bis 0.x
 * vor dem Stichjahr gerechnet hat (früher auswertungen/reports.ts und euer-quelle.ts). Nicht weiterentwickeln; die Datei
 * fällt mit dem Modul weg, sobald ein Release das Update über diese Version voraussetzt.
 */

const EINNAHMEN_IM_MONAT = new Set<EuerLineKey>(["einnahmenKleinunternehmer", "einnahmenSteuerpflichtig", "einnahmenSteuerfrei", "kursgewinne"]);
const AUSGABEN_IM_MONAT = (key: EuerLineKey) =>
  key.startsWith("ausgabe:") ||
  key.startsWith("pauschale:") ||
  ["personal", "kursverluste", "steuerNebenleistungen", "schuldzinsen", "schuldzinsenAnlage"].includes(key);

/**
 * Die Gegenprobe aus den Nebenbüchern mit den freien Buchungen des Jahres (#502, Herkunft „manuell“): Sie haben kein
 * Nebenbuch, ihr Beleg ist die festgeschriebene Buchung selbst; ohne sie meldete der Abgleich jede freie Buchung als
 * Abweichung. Zeilen nach euerAusZeilen wie in der EÜR aus dem Journal, die Monate netto wie dort.
 */
async function mitFreienBuchungen(euer: EuerResult, q: Db | Tx): Promise<EuerResult> {
  const e = schema.journalEntries;
  const frei = await buchungen(q, and(eq(e.sourceType, "manuell"), gte(e.date, `${euer.year}-01-01`), lt(e.date, `${euer.year + 1}-01-01`)));
  if (frei.length === 0) return euer;
  const summen = new Map<EuerLineKey, Cents>([...euer.einnahmen, ...euer.ausgaben].map((l) => [l.key, l.amount]));
  const monthly = { einnahmen: [...euer.monthly.einnahmen], ausgaben: [...euer.monthly.ausgaben] };
  let bewirtung = euer.bewirtungNichtAbziehbar;
  let gewerbesteuer = euer.gewerbesteuerNichtAbziehbar;
  for (const b of frei) {
    const summe = euerAusZeilen(b.kontenrahmen, b.zeilen, "sonst", leereEuerAusJournal());
    const monat = Number(b.date.slice(5, 7)) - 1;
    for (const [key, betrag] of Object.entries(summe.zeilen) as [EuerLineKey, Cents][]) {
      summen.set(key, (summen.get(key) ?? 0) + betrag);
      if (EINNAHMEN_IM_MONAT.has(key)) monthly.einnahmen[monat]! += betrag;
      else if (AUSGABEN_IM_MONAT(key)) monthly.ausgaben[monat]! += betrag;
    }
    bewirtung += summe.bewirtungNichtAbziehbar;
    gewerbesteuer += summe.gewerbesteuerNichtAbziehbar;
  }
  return euerErgebnis(euer.year, summen, monthly, bewirtung, gewerbesteuer);
}

/** Die EÜR aus den Nebenbüchern (Zahlungen, Belege, Pauschalen, Anlagenverzeichnis) mit den freien Buchungen */
export async function euerAusNebenbuechern(year: number, q: Db | Tx = db): Promise<EuerResult> {
  const euer = computeEuer(year, await euerPayments(year, q), await depreciationForEuer(year, q), await withdrawalsForEuer(year, q));
  return isKapitalgesellschaft((await loadCompany(q)).rechtsform) ? euer : mitFreienBuchungen(euer, q);
}
