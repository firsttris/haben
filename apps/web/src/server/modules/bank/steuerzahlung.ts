import {
  STEUER_POSTEN_KEYS,
  STEUERART_KEYS,
  privatZahlung,
  steuerKontierung,
  steuerzahlungPosting,
  steuerzahlungText,
  type Cents,
  type Kontenrahmen,
  type PostingLine,
  type Rechtsform,
  type Steuerangabe,
} from "@haben/core";
import { and, eq, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { UserError } from "../../errors.ts";
import { schema, type Tx } from "../../db/index.ts";

/*
 * Steuerzahlung als Zuordnung eines Bankumsatzes (Roadmap Platz 13): Kontierung und Buchung aus packages/core/src/
 * steuerzahlung.ts, hier dazu der Verbrauch der Steuerrückstellung einer GmbH oder UG.
 */

export class SteuerzahlungError extends UserError {}

export const steuerangabeSchema = z.object({
  art: z.enum(STEUERART_KEYS),
  jahr: z.number().int(),
  posten: z.enum(STEUER_POSTEN_KEYS),
});

/**
 * Was von der Rückstellung für das Bezugsjahr noch offen ist: zum 31.12. des Jahres gebildet (Haben − Soll auf dem
 * Rückstellungskonto in Buchungen dieses Tages außer Zahlungen, so bucht der Jahresabschluss die Rückstellung) abzüglich
 * dessen, was Steuerzahlungen für dasselbe Jahr schon verbraucht haben, höchstens der Saldo des Kontos am Tag der Zahlung
 * (etwa nach einer Auflösung von Hand).
 */
async function offeneRueckstellung(tx: Tx, konto: string, jahr: number, datum: string, kontenrahmen: Kontenrahmen): Promise<Cents> {
  // Zwei gleichzeitige Zahlungen sähen sonst dieselbe Rückstellung
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('haben.steuerrueckstellung'))`);
  const l = schema.journalLines;
  const e = schema.journalEntries;
  const haben = sql<number>`coalesce(sum(${l.credit} - ${l.debit}), 0)`.mapWith(Number);
  const konten = and(eq(l.account, konto), eq(e.kontenrahmen, kontenrahmen));
  const [gebildet] = await tx
    .select({ betrag: haben })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .where(and(konten, eq(e.date, `${jahr}-12-31`), ne(e.sourceType, "allocation")));
  // Verbraucht: Zahlungen für das Jahr samt Gegenbuchungen aufgehobener Zuordnungen (die Gegenzeile trägt dasselbe Jahr)
  const [verbraucht] = await tx
    .select({ betrag: haben })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .innerJoin(schema.allocations, and(eq(e.sourceType, "allocation"), eq(e.sourceId, schema.allocations.id)))
    .where(and(konten, eq(schema.allocations.taxYear, jahr), sql`${e.date} > ${`${jahr}-12-31`}`));
  const [saldo] = await tx
    .select({ betrag: haben })
    .from(l)
    .innerJoin(e, eq(e.id, l.entryId))
    .where(and(konten, lte(e.date, datum)));
  return Math.max(0, Math.min((gebildet?.betrag ?? 0) + (verbraucht?.betrag ?? 0), saldo?.betrag ?? 0));
}

export interface Steuerbuchung {
  lines: PostingLine[];
  description: string;
  target: { taxType: Steuerangabe["art"]; taxYear: number; taxItem: Steuerangabe["posten"] };
}

/** Buchung eines Teils eines Umsatzes als Steuerzahlung; lehnt ab, was Haben nicht sicher richtig buchen kann */
export async function steuerbuchung(
  tx: Tx,
  company: { kontenrahmen: Kontenrahmen; rechtsform: Rechtsform },
  bank: { bookingDate: string; counterpartyName: string; purpose: string | null },
  angabe: Steuerangabe,
  amount: Cents,
): Promise<Steuerbuchung> {
  const kontierung = steuerKontierung(angabe, amount, bank.bookingDate, company.kontenrahmen, company.rechtsform);
  if (!kontierung.ok) throw new SteuerzahlungError(kontierung.fehler);
  const ausRueckstellung = kontierung.rueckstellung
    ? Math.min(-amount, await offeneRueckstellung(tx, kontierung.rueckstellung, angabe.jahr, bank.bookingDate, company.kontenrahmen))
    : 0;
  // Umsatzsteuer auf einem privaten Konto (#866): Das Geld fließt ins Private oder kommt von dort, die Gegenzeile ist
  // deshalb die Privatentnahme bzw. -einlage, nicht die Bank.
  const zahlungskonto = angabe.art === "ust" && bank.purpose === "privat" ? privatZahlung(amount, company.kontenrahmen, company.rechtsform) : undefined;
  return {
    lines: steuerzahlungPosting(kontierung, amount, ausRueckstellung, company.kontenrahmen, zahlungskonto),
    description: `${steuerzahlungText(angabe, amount)} · ${bank.counterpartyName || "Finanzamt"}`,
    target: { taxType: angabe.art, taxYear: angabe.jahr, taxItem: angabe.posten },
  };
}
