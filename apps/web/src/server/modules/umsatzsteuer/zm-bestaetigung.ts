import { evatrFrischGueltig, evatrGueltig, evatrMeldung, evatrPruefbar } from "@haben/core";
import { inArray } from "drizzle-orm";
import { formatDate } from "../../../lib/format.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { bestaetigeNummer, type EvatrVerbindung, evatrMoeglich, letzteBestaetigungen, type UstIdBestaetigung } from "../stammdaten/index.ts";
import type { ZmIssue } from "./zm.ts";

/*
 * Bestätigung der gemeldeten USt-IdNrn. beim BZSt in der Vorprüfung der Zusammenfassenden Meldung (#1385). Die Vorprüfung
 * nennt jede Nummer, deren letzte Antwort fehlt oder nicht evatr-0000 ist; senden sperrt das nicht. Abgefragt wird einfach,
 * nacheinander (das BZSt verarbeitet nur Einzelabfragen), nach einem Ausfall nicht weiter (das BZSt bittet, später erneut zu
 * fragen); der Nachweis kommt an den Kontakt der Rechnung. Abgeschaltet oder ohne eigene USt-IdNr. wie vorher.
 */

type Stand = Pick<UstIdBestaetigung, "status" | "anfrageZeitpunkt" | "gueltigAb" | "gueltigBis">;

/** Nummern, die als Nächstes gemeldet würden (Erstmeldung oder Berichtigung), ohne entfallene Zeilen mit 0 € */
export const zuBestaetigendeNummern = (zeilen: readonly { ustId: string; betrag: number }[]) =>
  new Set(zeilen.filter((zeile) => zeile.betrag !== 0).map((zeile) => zeile.ustId));

/** Je gemeldeter Nummer ohne Antwort oder mit einer Antwort ungleich evatr-0000 eine Warnung; evatr-2008 ist gültig, nur ein Hinweis */
export function zmBestaetigungIssues(nummern: readonly string[], letzte: ReadonlyMap<string, Stand>): ZmIssue[] {
  return nummern.flatMap((nummer): ZmIssue[] => {
    const b = letzte.get(nummer);
    if (b?.status === "evatr-0000") return [];
    const text = b
      ? `${nummer}: am ${formatDate(b.anfrageZeitpunkt)} laut BZSt „${evatrMeldung(b)}“ (${b.status}).`
      : `${nummer}: beim BZSt noch nicht bestätigt.`;
    return [{ tone: b && evatrGueltig(b.status) ? "info" : "warn", text }];
  });
}

/** Für die Seite der Meldung: ob sich bestätigen lässt, wie viele Nummern keine frische gültige Antwort haben, und die Hinweise */
export async function zmBestaetigung(nummern: readonly string[], jetzt = new Date()): Promise<{ moeglich: boolean; offen: number; issues: ZmIssue[] }> {
  if (!(await evatrMoeglich())) return { moeglich: false, offen: 0, issues: [] };
  const pruefbar = [...new Set(nummern)].filter(evatrPruefbar);
  const letzte = await letzteBestaetigungen(pruefbar);
  return {
    moeglich: true,
    offen: pruefbar.filter((nummer) => !evatrFrischGueltig(letzte.get(nummer), jetzt)).length,
    issues: zmBestaetigungIssues(pruefbar, letzte),
  };
}

/**
 * Fragt jede Nummer der nächsten Meldung ohne frische gültige Antwort einfach ab, wie die Karte sie zählt: nicht schon
 * gemeldete oder im Quartal stornierte. Zurück kommen die Zahl der Abfragen und die Hinweise.
 */
export async function bestaetigeZmNummern(
  actor: string,
  meldung: { quellen: readonly { invoiceId: string; ustId: string }[]; naechste: { zeilen: readonly { ustId: string; betrag: number }[] } },
  options: { jetzt?: Date; via?: EvatrVerbindung } = {},
  q: Db | Tx = db,
): Promise<{ gefragt: number; hinweise: string[] }> {
  const jetzt = options.jetzt ?? new Date();
  const melden = zuBestaetigendeNummern(meldung.naechste.zeilen);
  const quellen = meldung.quellen.filter((quelle) => melden.has(quelle.ustId));
  const ids = [...new Set(quellen.map((quelle) => quelle.invoiceId))];
  const rechnungen = ids.length
    ? await q.select({ id: schema.invoices.id, contactId: schema.invoices.contactId }).from(schema.invoices).where(inArray(schema.invoices.id, ids))
    : [];
  const kontaktVon = new Map(rechnungen.map((r) => [r.id, r.contactId]));
  const nummern = [...new Set(quellen.map((quelle) => quelle.ustId))].filter(evatrPruefbar);
  const letzte = await letzteBestaetigungen(nummern);
  const hinweise: string[] = [];
  let gefragt = 0;
  const offen = nummern.filter((nummer) => !evatrFrischGueltig(letzte.get(nummer), jetzt));
  for (const [i, nummer] of offen.entries()) {
    const contactId = quellen.map((quelle) => (quelle.ustId === nummer ? kontaktVon.get(quelle.invoiceId) : null)).find(Boolean);
    if (!contactId) {
      hinweise.push(`${nummer}: keine Rechnung mit Kontakt, an dem der Nachweis stehen könnte`);
      continue;
    }
    gefragt += 1;
    const { hinweis, ausfall } = await bestaetigeNummer(actor, contactId, nummer, options.via);
    if (hinweis) hinweise.push(hinweis);
    if (ausfall && offen.length > i + 1) {
      hinweise.push(`${offen.slice(i + 1).join(", ")} nicht angefragt; versuch es später noch einmal.`);
      break;
    }
  }
  return { gefragt, hinweise };
}
