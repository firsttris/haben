import {
  addDays,
  isKapitalgesellschaft,
  STEUERARTEN,
  steuerartenFor,
  steuerGruppe,
  VORAUSZAHLUNGS_ARTEN,
  vorauszahlungsPosten,
  type Cents,
  type LiquiditaetsPosten,
  type VorauszahlungsArt,
} from "@haben/core";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { prepaymentBasis } from "../finanzamt/index.ts";
import type { Kontext } from "./kontext.ts";

/*
 * Ertragsteuer-Vorauszahlungen (#1381). Haben speichert keine Bescheidbeträge; Vorschlag bis zu einer Eingabe laut Bescheid:
 * die letzte im Bankabgleich zugeordnete Zahlung je Steuerart fortschreiben (erwartet), ohne Zahlung ein Viertel der
 * Prognose der Einkommensteuer (geschätzt). Für Körperschaft- und Gewerbesteuer gibt es keine Prognose des laufenden Jahres;
 * ohne Zahlung fehlen sie. Im Einzelunternehmen sind Einkommensteuer, Soli und Kirchensteuer privat (§ 12 Nr. 3 EStG):
 * Sie stehen trotzdem als Abfluss, weil sie meist vom Geschäftskonto gehen, und tragen „privat“.
 */

/** Eine Zahlung ist nur dann eine Vorauszahlung, wenn sie höchstens so alt ist; älter gilt die Festsetzung als überholt */
const LETZTE_ZAHLUNG_TAGE = 400;

interface Zahlung {
  art: VorauszahlungsArt;
  /** Positiv */
  betrag: Cents;
  datum: string;
  transactionId: string;
}

/**
 * Letzte Zahlung je Steuerart: Teil „Steuer“, Ausgang, nicht aufgehoben, für das Jahr der Zahlung. Eine Zahlung für ein
 * früheres Jahr ist eine Nachzahlung aus dem Bescheid, keine Vorauszahlung.
 */
async function letzteZahlungen(heute: string): Promise<Zahlung[]> {
  const rows = await db.execute<{ art: VorauszahlungsArt; betrag: number; datum: string; transaction_id: string }>(sql`
    select distinct on (a.tax_type) a.tax_type as art, -a.amount as betrag, coalesce(a.date, t.booking_date)::text as datum,
      a.transaction_id
    from allocations a join bank_transactions t on t.id = a.transaction_id
    where a.kind = 'steuer' and a.tax_item = 'steuer' and a.reverses_id is null and a.amount < 0
      and not exists (select 1 from allocations r where r.reverses_id = a.id)
      and a.tax_type in (${sql.join(
        VORAUSZAHLUNGS_ARTEN.map((a) => sql`${a}`),
        sql`, `,
      )})
      and a.tax_year = extract(year from coalesce(a.date, t.booking_date))
      and coalesce(a.date, t.booking_date) between ${addDays(heute, -LETZTE_ZAHLUNG_TAGE)} and ${heute}
    order by a.tax_type, coalesce(a.date, t.booking_date) desc, a.created_at desc`);
  return [...rows].map((r) => ({ art: r.art, betrag: Number(r.betrag), datum: r.datum, transactionId: r.transaction_id }));
}

/** Ein Viertel der Prognose für das laufende Jahr, mit Soli und Kirchensteuer; 0 ohne Angaben zur Person oder bei Erstattung */
async function viertelDerPrognose(heute: string): Promise<Cents> {
  const basis = await prepaymentBasis(heute);
  return Math.max(0, basis.prognose.jeQuartal);
}

export async function vorauszahlungPosten(k: Kontext): Promise<LiquiditaetsPosten[]> {
  const kapg = isKapitalgesellschaft(k.rechtsform);
  // Keine Einkommensteuer-Vorauszahlungen festgesetzt (#1240): auch keine für Soli und Kirchensteuer. Die GmbH hat keine
  // Einkommensteuer (steuerartenFor), zahlt den Soli aber auf die Körperschaftsteuer
  const ohneEst = !kapg && k.taxpayer.keineVorauszahlungen === true;
  const arten = steuerartenFor(k.rechtsform).filter(
    (art): art is VorauszahlungsArt => (VORAUSZAHLUNGS_ARTEN as readonly string[]).includes(art) && !(ohneEst && ["est", "soli", "kist"].includes(art)),
  );
  const zahlungen = (await letzteZahlungen(k.heute)).filter((z) => arten.includes(z.art));
  const gemeinsam = { heute: k.heute, bis: k.bis, bundesland: k.bundesland };
  const posten = zahlungen.flatMap((z) =>
    vorauszahlungsPosten({
      ...gemeinsam,
      art: z.art,
      betrag: z.betrag,
      letzteZahlung: z.datum,
      sicherheit: "erwartet",
      text: `${STEUERARTEN[z.art]}, wie zuletzt gezahlt`,
      quelleId: z.transactionId,
      privat: steuerGruppe(z.art, k.rechtsform) === "privat",
    }),
  );
  // Ohne jede Zahlung zur Einkommensteuer: ein Viertel der Prognose; sie rechnet Soli und Kirchensteuer mit
  const estGezahlt = zahlungen.some((z) => ["est", "soli", "kist"].includes(z.art));
  if (!kapg && !ohneEst && !estGezahlt && k.taxpayer.a) {
    posten.push(
      ...vorauszahlungsPosten({
        ...gemeinsam,
        art: "est",
        betrag: await viertelDerPrognose(k.heute),
        letzteZahlung: null,
        sicherheit: "geschaetzt",
        text: "Einkommensteuer, ein Viertel der Prognose",
        quelleId: k.heute.slice(0, 4),
        privat: true,
      }),
    );
  }
  return posten;
}
