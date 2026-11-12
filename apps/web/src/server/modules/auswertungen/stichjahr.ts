import { and, eq } from "drizzle-orm";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { isKapitalgesellschaft, JOURNAL_KENNZAHLEN } from "@haben/core";
import { journalAbJahr, loadCompany, setJournalAb } from "../stammdaten/index.ts";
import { kennzahlenBeiderQuellen } from "../umsatzsteuer/index.ts";
import { abgleichJahr, abweichungen } from "./abgleich.ts";
import { euerAusDemJournal } from "./euer-quelle.ts";
import { euerAusNebenbuechern } from "./reports.ts";

/*
 * Stichjahr, ab dem Voranmeldung und EÜR aus dem Journal rechnen (#542, docs/adr/journal-als-quelle.md, Entscheidung 1):
 * anzeigen und auf das laufende Jahr vorziehen. Vorziehen geht nur, solange im laufenden Jahr keine Voranmeldung gesendet
 * ist (gesendet ist gesendet, sie käme aus den Nebenbüchern), der Abgleich des Jahres keine Abweichung zeigt und jede
 * Voranmeldung des Jahres sowie die EÜR aus beiden Quellen gleich herauskommen: Dann ändert der Umstieg keine Zahl. Zurück
 * geht es nicht.
 */

export class StichjahrError extends UserError {}

export interface StichjahrStand {
  /** Ab diesem Jahr aus dem Journal */
  stichjahr: number;
  /** Das laufende Jahr */
  jahr: number;
  /** Lässt sich das Stichjahr auf das laufende Jahr vorziehen? */
  vorziehbar: boolean;
  /** Warum nicht, wenn das Stichjahr nach dem laufenden Jahr liegt */
  gruende: string[];
}

export async function stichjahrStand(today: string, q: Db | Tx = db): Promise<StichjahrStand> {
  const stichjahr = await journalAbJahr(q);
  const jahr = Number(today.slice(0, 4));
  if (stichjahr <= jahr) return { stichjahr, jahr, vorziehbar: false, gruende: [] };
  const gruende: string[] = [];
  const r = schema.vatReturns;
  const [gesendet] = await q
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.year, jahr), eq(r.status, "sent")))
    .limit(1);
  if (gesendet) gruende.push(`Für ${jahr} ist schon eine Voranmeldung gesendet; sie kam aus den Nebenbüchern.`);
  const anzahl = abweichungen((await abgleichJahr(jahr, today, q)).zeilen).length;
  if (anzahl > 0) {
    gruende.push(`Der Abgleich ${jahr} zeigt ${anzahl === 1 ? "eine Abweichung" : `${anzahl} Abweichungen`} zwischen Journal und Nebenbüchern.`);
  }
  // Gleich gerechnet: Der Abgleich lässt ältere Buchungen ohne Bemessungsgrundlage bzw. Steuerschlüssel aus (vor #551,
  // #552); nach dem Umstieg zählten sie anders. Deshalb jede Voranmeldung des Jahres und die EÜR aus beiden Quellen
  const monate: number[] = [];
  for (let month = 1; month <= Number(today.slice(5, 7)); month++) {
    const { journal, nebenbuecher } = await kennzahlenBeiderQuellen({ year: jahr, month }, q);
    if (JOURNAL_KENNZAHLEN.some((feld) => journal[feld] !== nebenbuecher[feld])) monate.push(month);
  }
  if (monate.length > 0) {
    gruende.push(
      `Die Voranmeldung für ${monate.map((m) => `${String(m).padStart(2, "0")}/${jahr}`).join(", ")} käme aus dem Journal anders heraus; dort stehen ältere Buchungen ohne Bemessungsgrundlage oder Steuerschlüssel.`,
    );
  }
  if (!isKapitalgesellschaft((await loadCompany(q)).rechtsform)) {
    const zeilen = (e: Awaited<ReturnType<typeof euerAusNebenbuechern>>) => JSON.stringify([e.einnahmen, e.ausgaben, e.gewinn]);
    if (zeilen(await euerAusDemJournal(jahr, q)) !== zeilen(await euerAusNebenbuechern(jahr, q))) {
      gruende.push(`Die EÜR ${jahr} käme aus dem Journal anders heraus.`);
    }
  }
  return { stichjahr, jahr, vorziehbar: gruende.length === 0, gruende };
}

/** Stichjahr auf das laufende Jahr vorziehen; prüft in der Transaktion noch einmal wie stichjahrStand */
export async function stichjahrVorziehen(actor: string, today: string): Promise<number> {
  return withActor(actor, async (tx) => {
    // Firmendaten sperren: Eine gleichzeitige Änderung wartet, bis das Stichjahr steht
    await tx.select({ id: schema.company.id }).from(schema.company).where(eq(schema.company.id, 1)).for("update");
    const stand = await stichjahrStand(today, tx);
    if (stand.stichjahr <= stand.jahr) throw new StichjahrError(`Voranmeldung und EÜR rechnen schon ab ${stand.stichjahr} aus dem Journal.`);
    if (!stand.vorziehbar) throw new StichjahrError(stand.gruende.join(" "));
    await setJournalAb(tx, stand.jahr);
    return stand.jahr;
  });
}
