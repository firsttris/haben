import { dauerfristActive, ustVorauszahlungImVorjahr, type DauerfristSetting } from "@haben/core";
import { and, eq, gte, inArray, isNull, lte, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { schema, type Db, type Tx } from "../../db/index.ts";

/**
 * #652: Nur ein Hinweis, keine Neuberechnung gespeicherter Erklärungen. Die Zehn-Tage-Regel kommt wie in der EÜR aus
 * ustVorauszahlungImVorjahr (§ 11 Abs. 2 Satz 2 EStG; BFH VIII R 25/20: Dauerfrist verschiebt die Fälligkeit auf Februar).
 * Quelle: https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202210196/
 */
export async function dauerfristEuerHinweis(q: Db | Tx, before: readonly DauerfristSetting[], setting: DauerfristSetting): Promise<string | null> {
  const s = schema.annualSubmissions;
  const filed = await q
    .selectDistinct({ year: s.year, form: s.form })
    .from(s)
    // Auch eine außerhalb von Haben abgegebene und vermerkte EÜR ist abgegeben (#760)
    .where(and(inArray(s.form, ["euer", "est"]), inArray(s.kind, ["send", "vermerk"]), eq(s.ok, true)))
    .orderBy(s.year, s.form);
  const after = [...before.filter((row) => row.year !== setting.year), setting];
  // Ein Stand gilt auch für Folgejahre ohne eigenen Eintrag. Beide möglichen EÜR-Jahre einer Januarzahlung beachten.
  const years = [...new Set(filed.flatMap((row) => [row.year, row.year - 1]))].filter(
    (year) => dauerfristActive(before, year) !== dauerfristActive(after, year),
  );
  if (years.length === 0) return null;

  const a = schema.allocations;
  const t = schema.bankTransactions;
  const v = schema.vatReturns;
  const reversed = alias(schema.allocations, "dauerfrist_gegenzuordnung");
  const payments = await q
    .select({ year: v.year, month: v.month, date: t.bookingDate, amount: t.amount })
    .from(a)
    .innerJoin(t, eq(t.id, a.transactionId))
    .innerJoin(v, eq(v.id, a.vatReturnId))
    .where(
      and(
        eq(a.kind, "ustVorauszahlung"),
        isNull(a.reversesId),
        notExists(q.select({ id: reversed.id }).from(reversed).where(eq(reversed.reversesId, a.id))),
        or(...years.map((year) => and(eq(v.year, year), gte(t.bookingDate, `${year + 1}-01-01`), lte(t.bookingDate, `${year + 1}-01-10`)))),
      ),
    );
  const affected = new Set<number>();
  for (const payment of payments) {
    const input = { buchungstag: payment.date, zeitraum: { year: payment.year, month: payment.month }, abfluss: payment.amount < 0 };
    if (
      ustVorauszahlungImVorjahr({ ...input, dauerfrist: dauerfristActive(before, payment.year) }) !==
      ustVorauszahlungImVorjahr({ ...input, dauerfrist: dauerfristActive(after, payment.year) })
    ) {
      affected.add(payment.year);
      affected.add(payment.year + 1);
    }
  }
  const names = filed.filter((row) => affected.has(row.year)).map((row) => `${row.form === "euer" ? "EÜR" : "Einkommensteuererklärung"} ${row.year}`);
  if (names.length === 0) return null;
  return `${names.join(", ")} ${names.length === 1 ? "ist" : "sind"} bereits übermittelt und ${names.length === 1 ? "bleibt" : "bleiben"} unverändert. Die geänderte Dauerfristverlängerung betrifft die Zuordnung einer Vorauszahlung zum EÜR-Jahr. Ob eine Berichtigung nötig ist, klärst du mit der Steuerberatung.`;
}
