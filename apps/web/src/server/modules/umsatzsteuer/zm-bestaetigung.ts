import { evatrFrisch, evatrGueltig, evatrMeldung, evatrPruefbar } from "@haben/core";
import { inArray } from "drizzle-orm";
import { formatDate } from "../../../lib/format.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { bestaetigeNummer, type EvatrVerbindung, evatrMoeglich, letzteBestaetigungen, type UstIdBestaetigung } from "../stammdaten/index.ts";
import type { ZmIssue } from "./zm.ts";

/*
 * Bestätigung der gemeldeten USt-IdNrn. beim BZSt in der Vorprüfung der Zusammenfassenden Meldung (#1385). Die Vorprüfung
 * nennt jede Nummer, deren letzte Antwort fehlt oder nicht evatr-0000 ist, als Hinweis; senden sperrt das nicht. Abgefragt
 * wird einfach, nacheinander (das BZSt verarbeitet nur Einzelabfragen), der Nachweis kommt an den Kontakt der Rechnung.
 * Abgeschaltet oder ohne eigene USt-IdNr. bleibt die Vorprüfung wie vorher.
 */

type Stand = Pick<UstIdBestaetigung, "status" | "anfrageZeitpunkt" | "gueltigAb" | "gueltigBis">;

const frischGueltig = (b: Stand | undefined, jetzt: Date) => Boolean(b && evatrGueltig(b.status) && evatrFrisch(b.anfrageZeitpunkt, jetzt));

/** Hinweis je gemeldeter Nummer ohne Antwort oder mit einer Antwort ungleich evatr-0000 */
export function zmBestaetigungIssues(nummern: readonly string[], letzte: ReadonlyMap<string, Stand>): ZmIssue[] {
  return nummern.flatMap((nummer): ZmIssue[] => {
    const b = letzte.get(nummer);
    if (b?.status === "evatr-0000") return [];
    const text = b
      ? `${nummer}: am ${formatDate(b.anfrageZeitpunkt)} laut BZSt „${evatrMeldung(b)}“ (${b.status}).`
      : `${nummer}: beim BZSt noch nicht bestätigt.`;
    return [{ tone: "warn", text }];
  });
}

/** Für die Seite der Meldung: ob sich bestätigen lässt, wie viele Nummern keine frische gültige Antwort haben, und die Hinweise */
export async function zmBestaetigung(nummern: readonly string[], jetzt = new Date()): Promise<{ moeglich: boolean; offen: number; issues: ZmIssue[] }> {
  if (!(await evatrMoeglich())) return { moeglich: false, offen: 0, issues: [] };
  const pruefbar = [...new Set(nummern)].filter(evatrPruefbar);
  const letzte = await letzteBestaetigungen(pruefbar);
  return {
    moeglich: true,
    offen: pruefbar.filter((nummer) => !frischGueltig(letzte.get(nummer), jetzt)).length,
    issues: zmBestaetigungIssues(pruefbar, letzte),
  };
}

/** Fragt jede gemeldete Nummer ohne frische gültige Antwort einfach ab; zurück kommen die Zahl der Abfragen und die Hinweise */
export async function bestaetigeZmNummern(
  actor: string,
  quellen: readonly { invoiceId: string; ustId: string }[],
  options: { jetzt?: Date; via?: EvatrVerbindung } = {},
  q: Db | Tx = db,
): Promise<{ gefragt: number; hinweise: string[] }> {
  const jetzt = options.jetzt ?? new Date();
  const ids = [...new Set(quellen.map((quelle) => quelle.invoiceId))];
  const rechnungen = ids.length
    ? await q.select({ id: schema.invoices.id, contactId: schema.invoices.contactId }).from(schema.invoices).where(inArray(schema.invoices.id, ids))
    : [];
  const kontaktVon = new Map(rechnungen.map((r) => [r.id, r.contactId]));
  const nummern = [...new Set(quellen.map((quelle) => quelle.ustId))].filter(evatrPruefbar);
  const letzte = await letzteBestaetigungen(nummern);
  const hinweise: string[] = [];
  let gefragt = 0;
  for (const nummer of nummern) {
    if (frischGueltig(letzte.get(nummer), jetzt)) continue;
    const contactId = quellen.map((quelle) => (quelle.ustId === nummer ? kontaktVon.get(quelle.invoiceId) : null)).find(Boolean);
    if (!contactId) {
      hinweise.push(`${nummer}: keine Rechnung mit Kontakt, an dem der Nachweis stehen könnte`);
      continue;
    }
    gefragt += 1;
    const { hinweis } = await bestaetigeNummer(actor, contactId, nummer, options.via);
    if (hinweis) hinweise.push(hinweis);
  }
  return { gefragt, hinweise };
}
