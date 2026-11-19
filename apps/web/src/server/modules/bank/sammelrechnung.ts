import { suggestMatches, type MatchTransaction, type OpenItem, type Suggestion } from "@haben/core";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import { bankDuplicateProposalEligibleSql, bankOpenAmountSql } from "../../db/bank-open.ts";

/**
 * Summe der noch offenen Gebühren- und Gutschriftzeilen eines Zahlungsdienstleisters in einem Monat. Der Dienstleister
 * stellt seine Gebühren als Sammelrechnung über alle Zeilen eines Monats und rechnet Gutschriften ein (Etsy: Gutschrift
 * einer Gebühr bei Erstattung); erst diese Summe passt zum offenen Betrag des Belegs.
 */
async function offeneGebuehrenSumme(bankAccountId: string, monat: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${bankOpenAmountSql}), 0)`.mapWith(Number) })
    .from(schema.bankTransactions)
    .where(
      and(
        eq(schema.bankTransactions.bankAccountId, bankAccountId),
        sql`to_char(${schema.bankTransactions.bookingDate}, 'YYYY-MM') = ${monat}`,
        sql`${schema.bankTransactions.purpose} like 'Gebühr%'`,
        sql`${bankOpenAmountSql} <> 0`,
        bankDuplicateProposalEligibleSql,
      ),
    );
  return row?.total ?? 0;
}

export type Sammelrechnung = { summe: number; documentId: string | null };

/**
 * Gebühren eines Zahlungsdienstleisters kommen als mehrere Zeilen eines Monats an; die Sammelrechnung des Monats trägt
 * ihre Summe. Der Abgleich bewertet eine Zeile gegen einen Beleg und passt nie; erst die Monatssumme stimmt exakt.
 * Liefert für eine offene Gebührenzeile die Monatssumme, den Beleg mit genau diesem offenen Betrag und dessen Vorschlag.
 */
export async function sammelrechnungVorschlag(
  tx: MatchTransaction & { bankAccountId: string; open: number },
  kontoZweck: string | undefined,
  items: OpenItem[],
): Promise<{ sammelrechnung: Sammelrechnung | null; sammelbeleg: Suggestion | null }> {
  if (kontoZweck !== "zahlungsdienstleister" || tx.amount >= 0 || tx.open === 0 || !tx.purpose.startsWith("Gebühr")) {
    return { sammelrechnung: null, sammelbeleg: null };
  }
  const summe = await offeneGebuehrenSumme(tx.bankAccountId, tx.bookingDate.slice(0, 7));
  const beleg = summe !== 0 ? items.find((i) => i.type === "document" && i.open === summe) : undefined;
  if (!beleg) return { sammelrechnung: { summe, documentId: null }, sammelbeleg: null };
  // Bewertung mit der Monatssumme: nur so greift „Betrag stimmt exakt“ (50 Punkte)
  const [treffer] = suggestMatches({ ...tx, amount: summe }, [beleg], 1);
  // Zugeordnet würde der Sammelknopf alle Zeilen; als Vorschlag der Zeile zählt ihr eigener offener Betrag
  return { sammelrechnung: { summe, documentId: beleg.id }, sammelbeleg: treffer ? { ...treffer, amount: tx.open } : null };
}
