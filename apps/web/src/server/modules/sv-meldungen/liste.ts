import {
  type Beitragsnachweis,
  beitragsnachweis,
  type DeuevMeldung,
  type Einzugsstelle,
  einzugsstelle,
  meldungen,
  monatsgrenzen,
  monatsname,
  type SvPerson,
} from "@haben/core";
import { db, type Db, type Tx } from "../../db/index.ts";
import type { SvPortalWert } from "../../db/schema.ts";
import { type SvLohnDaten, svLohnDaten } from "../lohn/index.ts";
import { loadCompany } from "../stammdaten/index.ts";

/*
 * Ausfüllliste für das SV-Meldeportal (docs/lohn-plan.md, PR 6): je Monat die Beitragsnachweise je Einzugsstelle und je
 * Person die DEÜV-Meldungen, gerechnet in @haben/core aus den festgeschriebenen Abrechnungen und den Stammdaten.
 * Gelesen wird nur; geschrieben werden allein die Vermerke (vermerke.ts).
 */

export interface ListenDaten extends SvLohnDaten {
  steuernummer: string;
}

export async function listenDaten(q: Db | Tx = db): Promise<ListenDaten> {
  const [lohn, company] = await Promise.all([svLohnDaten(q), loadCompany(q)]);
  return { ...lohn, steuernummer: company.steuernummer };
}

const imMonat = (p: SvPerson, jahr: number, monat: number) => {
  const { erster, letzter } = monatsgrenzen(jahr, monat);
  return p.lohn.eintritt <= letzter && (p.lohn.austritt === null || p.lohn.austritt >= erster);
};

const nameVon = (p: SvPerson) => `${p.vorname} ${p.nachname}`;

/**
 * Beitragsnachweise eines Monats: je Einzugsstelle, bei der eine festgeschriebene Abrechnung oder ein im Monat
 * Beschäftigter mit Sozialversicherung liegt. Wer noch keine festgeschriebene Abrechnung hat, steht als Hinweis daneben.
 */
export function beitragsnachweiseImMonat(d: ListenDaten, jahr: number, monat: number): Beitragsnachweis[] {
  const abrechnungen = d.abrechnungen.filter((a) => a.jahr === jahr && a.monat === monat);
  const beschaeftigt = d.mitarbeiter.filter((m) => einzugsstelle(m.person) && imMonat(m.person, jahr, monat));
  const stellen = new Map<string, Einzugsstelle>();
  for (const p of [...abrechnungen.map((a) => a.person), ...beschaeftigt.map((m) => m.person)]) {
    const stelle = einzugsstelle(p);
    if (stelle && !stellen.has(stelle.betriebsnummer)) stellen.set(stelle.betriebsnummer, stelle);
  }
  return [...stellen.values()].map((stelle) => {
    const eigene = abrechnungen.filter((a) => einzugsstelle(a.person)?.betriebsnummer === stelle.betriebsnummer);
    const abgerechnet = new Set(eigene.map((a) => a.employeeId));
    const ohneAbrechnung = beschaeftigt
      .filter((m) => einzugsstelle(m.person)?.betriebsnummer === stelle.betriebsnummer && !abgerechnet.has(m.id))
      .map((m) => nameVon(m.person));
    return beitragsnachweis({ jahr, monat, einzugsstelle: stelle, abrechnungen: eigene, ohneAbrechnung, steuernummer: d.steuernummer });
  });
}

export const beitragsnachweisTitel = (b: Beitragsnachweis): string => `Beitragsnachweis ${monatsname(b.jahr, b.monat)} · ${b.einzugsstelle.name}`;

/** Alle DEÜV-Meldungen bis zum Jahr, je Mitarbeiter mit Sozialversicherung */
export function alleMeldungen(d: ListenDaten, bisJahr: number): (DeuevMeldung & { employeeId: string })[] {
  return d.mitarbeiter.flatMap((m) =>
    meldungen(
      {
        employeeId: m.id,
        person: m.person,
        abrechnungen: d.abrechnungen.filter((a) => a.employeeId === m.id),
        zahltage: d.zahltage,
        steuernummer: d.steuernummer,
      },
      bisJahr,
    ).map((meldung) => ({ ...meldung, employeeId: m.id })),
  );
}

/** Gesellschafter-Geschäftsführer ohne SV-Pflicht: keine Meldungen, kein Beitragsnachweis */
export const ohneSozialversicherung = (d: ListenDaten): string[] => d.mitarbeiter.filter((m) => !einzugsstelle(m.person)).map((m) => nameVon(m.person));

/** Die Felder flach, wie sie ein Vermerk festhält */
export const werteVon = (e: Pick<Beitragsnachweis, "abschnitte">): SvPortalWert[] =>
  e.abschnitte.flatMap((a) => a.felder.map((f) => ({ abschnitt: a.titel, name: f.name, wert: f.wert })));

/**
 * Erster Monat, für den Haben Fristen nennt: der erste Lohnlauf in Haben, ohne Lohnlauf der laufende Monat. Was davor
 * liegt, hat die bisherige Lohnabrechnung gemeldet.
 */
export function startMonat(d: ListenDaten, heute: string): string {
  const laufend = heute.slice(0, 7);
  return d.ersterLohnlauf && d.ersterLohnlauf < laufend ? d.ersterLohnlauf : laufend;
}
