import { euerAusZeilen, euerErgebnis, leereEuerAusJournal, type Cents, type EuerLineKey, type EuerResult } from "@haben/core";
import { and, eq, gte, lt } from "drizzle-orm";
import { depreciationForEuer, listAssets, withdrawalsForEuer } from "../buchhaltung/index.ts";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { euerAusJournal } from "./euer-journal.ts";
import { buchungen } from "./euer-journal-buchungen.ts";

/*
 * EÜR ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md, Entscheidung 3): die Zeilen aus euerAusJournal,
 * AfA und Privatnutzung aus dem Journal, sobald das Jahr gebucht ist, vorher aus dem Anlagenverzeichnis. Die Monate für die
 * Grafik netto wie computeEuer: Einnahmen und Ausgaben ohne Umsatz- und Vorsteuer, Zahlungen an das Finanzamt, AfA und
 * Privatnutzung.
 */

/** Zeilen aus den Buchungen des Anlagenverzeichnisses */
const ANLAGE: EuerLineKey[] = ["afa", "gwg", "sammelposten", "restbuchwert", "privateKfz", "ustEntnahmen"];
const EINNAHMEN_IM_MONAT = new Set<EuerLineKey>(["einnahmenKleinunternehmer", "einnahmenSteuerpflichtig", "einnahmenSteuerfrei", "kursgewinne"]);
const AUSGABEN_IM_MONAT = (key: EuerLineKey) =>
  key.startsWith("ausgabe:") ||
  key.startsWith("pauschale:") ||
  ["personal", "kursverluste", "steuerNebenleistungen", "schuldzinsen", "schuldzinsenAnlage"].includes(key);

export async function euerAusDemJournal(year: number, q: Db | Tx): Promise<EuerResult> {
  const { summe, monate } = await euerAusJournal(year, q);
  // Ohne Zeilen, die sich aufheben (Zahlung und Aufhebung): computeEuer verrechnet sie vorher, die Zeile entsteht dort nicht
  const summen = new Map((Object.entries(summe.zeilen) as [EuerLineKey, Cents][]).filter(([, betrag]) => betrag !== 0));
  // Noch nicht gebucht: AfA und Privatnutzung aus dem Anlagenverzeichnis, die schon gebuchten Anlagen nicht doppelt
  const offen = (await listAssets(year, q)).some((a) => a.pending);
  if (offen) for (const key of ANLAGE) summen.delete(key);
  const monat = (m: (typeof monate)[number], einnahmen: boolean) =>
    (Object.entries(m.zeilen) as [EuerLineKey, Cents][])
      .filter(([key]) => (einnahmen ? EINNAHMEN_IM_MONAT.has(key) : AUSGABEN_IM_MONAT(key)))
      .reduce((s, [, betrag]) => s + betrag, 0);
  return euerErgebnis(
    year,
    summen,
    { einnahmen: monate.map((m) => monat(m, true)), ausgaben: monate.map((m) => monat(m, false)) },
    summe.bewirtungNichtAbziehbar,
    summe.gewerbesteuerNichtAbziehbar,
    offen ? await depreciationForEuer(year, q) : undefined,
    offen ? await withdrawalsForEuer(year, q) : undefined,
  );
}

/**
 * Die Gegenprobe aus den Nebenbüchern mit den freien Buchungen des Jahres (#502, Herkunft „manuell“): Sie haben kein
 * Nebenbuch, ihr Beleg ist die festgeschriebene Buchung selbst; ohne sie meldete der Abgleich jede freie Buchung als
 * Abweichung. Zeilen nach euerAusZeilen wie in der EÜR aus dem Journal, die Monate netto wie dort.
 */
export async function mitFreienBuchungen(euer: EuerResult, q: Db | Tx): Promise<EuerResult> {
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
