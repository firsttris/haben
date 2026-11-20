import { addMonthsAnchored, evatrFrisch, evatrGueltig, evatrMeldung, evatrPruefbar, germanDay, normalizeUstId } from "@haben/core";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { berlinHour } from "../mail/index.ts";
import { bestaetigeNummer, type EvatrVerbindung, evatrMoeglich, letzteBestaetigungen } from "../stammdaten/index.ts";

/*
 * USt-IdNrn. der EU-Kunden im Hintergrund neu bestätigen (#1489). Eine Bestätigung erst nach dem Umsatz genügt nicht der
 * Sorgfalt eines ordentlichen Kaufmanns (UStAE 6a.8 Abs. 6), und eine Nummer kann nach der Bestätigung ungültig werden.
 * Höchstens einmal am Tag, zwischen 7 und 22 Uhr (das BZSt wartet seinen Dienst zwischen 23 und 5 Uhr), fragt der Lauf jede
 * Nummer aus festgeschriebenen Rechnungen mit Reverse Charge oder innergemeinschaftlicher Lieferung der letzten 12 Monate,
 * die noch am Kontakt der Rechnung steht und deren letzte Antwort älter als 30 Tage ist (EVATR_FRIST_TAGE); so ist jede höchstens einmal
 * im Monat dran, auch eine, die das BZSt syntaktisch falsch nennt (evatrNachweis). Einfach,
 * nacheinander, nach einem Ausfall nicht weiter (das BZSt bittet, bei Timeouts zu einer anderen Tageszeit erneut zu fragen;
 * Wartung und Bitte: Seite „Bestätigung ausländischer USt-IdNrn.“ auf bzst.de, gelesen 2026-11-20); der Nachweis kommt an den Kontakt
 * der jüngsten dieser Rechnungen, wie beim Knopf der ZM. Die qualifizierte Abfrage bleibt bei Kontakt und Festschreiben, so fallen
 * keine Abfragen gegen deren Höchstzahl an (evatr-0008). Abgeschaltet oder ohne eigene USt-IdNr. läuft nichts.
 */

export const USTID_PRUEFUNG_ACTOR = "system:ustid";

interface Kunde {
  contactId: string;
  kontakt: string;
}

/**
 * Je USt-IdNr. aus den Rechnungen der letzten 12 Monate der Kontakt der jüngsten Rechnung, an dem sie noch steht (#1578);
 * trägt sie kein Kontakt mehr, fehlt sie: Für die alte Rechnung hilft eine Bestätigung nach dem Umsatz nicht (UStAE 6a.8
 * Abs. 6). Tragen zwei Kontakte dieselbe Nummer, zählt auch der einer älteren Rechnung, denn die Nummer ist noch in Gebrauch.
 */
async function nummernDerRechnungen(heute: string): Promise<Map<string, Kunde>> {
  const i = schema.invoices;
  const c = schema.contacts;
  const rows = await db
    .select({ contactId: c.id, kontakt: c.name, kontaktUstId: c.ustId, buyer: i.buyer })
    .from(i)
    .innerJoin(c, eq(c.id, i.contactId))
    .where(
      and(
        inArray(i.taxTreatment, ["reverse_charge", "ig_lieferung"]),
        eq(i.status, "final"),
        gte(i.issueDate, addMonthsAnchored(heute, -12, Number(heute.slice(8, 10)))),
      ),
    )
    .orderBy(desc(i.issueDate), desc(i.createdAt));
  const nummern = new Map<string, Kunde>();
  for (const row of rows) {
    const nummer = normalizeUstId(row.buyer?.ustId ?? "");
    if (evatrPruefbar(nummer) && normalizeUstId(row.kontaktUstId) === nummer && !nummern.has(nummer)) {
      nummern.set(nummer, { contactId: row.contactId, kontakt: row.kontakt });
    }
  }
  return nummern;
}

/** Für den Scheduler; null, wenn heute nichts zu tun war. ausfall: der Hinweis, mit dem der Lauf abbrach */
export async function runDueUstIdPruefung(jetzt = new Date(), via?: EvatrVerbindung) {
  const tag = germanDay(jetzt);
  const state = globalThis as { __habenUstIdPruefung?: string };
  const stunde = berlinHour(jetzt);
  if (state.__habenUstIdPruefung === tag || stunde < 7 || stunde >= 22 || !(await evatrMoeglich())) return null;
  // Schon vor dem Abfragen: Nach einem Ausfall fragt erst der Lauf am nächsten Tag
  state.__habenUstIdPruefung = tag;
  const nummern = await nummernDerRechnungen(tag);
  const letzte = await letzteBestaetigungen([...nummern.keys()]);
  const offen = [...nummern].filter(([nummer]) => {
    const antwort = letzte.get(nummer);
    return !antwort || !evatrFrisch(antwort.anfrageZeitpunkt, jetzt);
  });
  let gefragt = 0;
  for (const [nummer, { contactId }] of offen) {
    gefragt += 1;
    const { hinweis, ausfall } = await bestaetigeNummer(USTID_PRUEFUNG_ACTOR, contactId, nummer, via);
    if (ausfall) return { gefragt, offen: offen.length, ausfall: hinweis };
  }
  return { gefragt, offen: offen.length, ausfall: null };
}

export interface UngueltigeUstId {
  contactId: string;
  kontakt: string;
  nummer: string;
  /** Die Antwort, die die Nummer ungültig nennt */
  bestaetigungId: string;
  anfrageZeitpunkt: Date;
  meldung: string;
}

/**
 * Für Übersicht und Erinnerungs-Mail: Nummern aus den Rechnungen der letzten 12 Monate, deren letzte Antwort sie nicht gültig
 * nennt, solange sie noch die USt-IdNr. des Kontakts sind; eine geänderte Nummer am Kontakt erledigt den Hinweis.
 */
export async function ungueltigeUstIdNrn(heute: string): Promise<UngueltigeUstId[]> {
  const nummern = await nummernDerRechnungen(heute);
  if (nummern.size === 0) return [];
  const letzte = await letzteBestaetigungen([...nummern.keys()]);
  return [...nummern].flatMap(([nummer, { contactId, kontakt }]): UngueltigeUstId[] => {
    const antwort = letzte.get(nummer);
    if (!antwort || evatrGueltig(antwort.status)) return [];
    return [
      {
        contactId,
        kontakt,
        nummer,
        bestaetigungId: antwort.id,
        anfrageZeitpunkt: new Date(antwort.anfrageZeitpunkt),
        meldung: evatrMeldung(antwort),
      },
    ];
  });
}
