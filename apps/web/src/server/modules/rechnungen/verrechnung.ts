import { randomUUID } from "node:crypto";
import { formatEuro, invoiceVerrechnungPosting, type Kontenrahmen, type PostingLine } from "@haben/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { reverseLinesIn } from "../bank/index.ts";
import { openBooks, post } from "../buchhaltung/index.ts";
import { listInvoices } from "./invoices.ts";

/*
 * Verrechnung einer Ausgangsrechnung mit ihrer Kundenkorrektur ohne Zahlung (#877, zweite Stufe aus #274).
 *
 * Wie bei den Eingangsbelegen in bank/verrechnung.ts bleibt der Belegbetrag stehen und nur der offene Rest sinkt: Die
 * Rechnung behält 159,00 €, ihr offener Rest geht auf 141,50 €, und die Korrektur gilt als erledigt. Dafür zwei Zeilen in
 * `invoice_settlements` mit gemeinsamer `settlement_id`, damit jede Seite für sich zählt; aufgehoben wird per
 * Gegenzeilpaar wie bei den Ausbuchungen.
 *
 * Gebucht wird je Seite eine eigene Buchung (source_type 'verrechnung', source_id der Zeile): Forderungen gegen
 * Verrechnungskonto (SKR03 1590, SKR04 1370). Zusammen steht das Verrechnungskonto auf null, und die Buchung trägt den
 * Vorgang, den der DATEV-Export für das Personenkonto braucht. Die Verrechnung selbst ist umsatzsteuerlich neutral: Die
 * Minderung der Umsatzsteuer nach § 17 Abs. 1 UStG hängt an der Korrektur (Soll im Korrekturmonat, Ist am Geld), nicht
 * an der Aufrechnung, deshalb trägt keine Zeile Steuer und keine `tax_shares`.
 *
 * Grenze (#877, Frage 2): Verrechnet wird höchstens bis zum offenen Rest der Rechnung. Was darüber hinausgeht, bleibt als
 * offener Posten der Korrektur stehen — das Guthaben des Kunden — und wird über den Bankumsatz der Rückzahlung oder eine
 * neue Rechnung ausgeglichen. Einen eigenen Vorgang „Überzahlung“ gibt es nicht.
 */

export const invoiceSettlementSchema = z.object({
  /** Rechnung oder Korrektur, von der aus verrechnet wird (in der Oberfläche der gerade offene Beleg) */
  invoiceId: z.uuid(),
  /** Die andere Seite: die Korrektur zur Rechnung oder die Rechnung zur Korrektur */
  counterInvoiceId: z.uuid(),
  /** Betrag ohne Vorzeichen; die Richtung ergibt sich aus den offenen Resten */
  amount: z.number().int().positive(),
  /** Tag der Aufrechnung; verrechnet wird, wenn aufgerechnet wird, nicht rückwirkend */
  date: z.iso.date(),
  /** Grund der Verrechnung, etwa die Nummer der Korrektur */
  note: z.string().trim().min(1, "Bitte den Grund der Verrechnung angeben.").max(500),
});

/** Aufhebung einer Verrechnung: Pflicht ist der Tag, an dem sie erklärt wird */
export const invoiceSettlementReversalSchema = z.object({
  /** Zeile der Verrechnung, die aufgehoben wird */
  id: z.uuid(),
  /** Tag der Aufhebung; sie wirkt an diesem Tag, nicht rückwirkend */
  date: z.iso.date(),
  /** Ergänzung zur Aufhebung, etwa der Grund */
  note: z.string().trim().max(500).optional(),
});

export type InvoiceSettlementInput = z.input<typeof invoiceSettlementSchema>;

export class InvoiceSettlementError extends UserError {}

/** Eine Rechnung, wie Verrechnung und Aufhebung sie brauchen; `sperren` nimmt die Zeilensperre der Transaktion */
async function rechnung(tx: Tx, id: string, sperren = false) {
  const abfrage = tx
    .select({
      id: schema.invoices.id,
      kind: schema.invoices.kind,
      status: schema.invoices.status,
      number: schema.invoices.number,
      issueDate: schema.invoices.issueDate,
      gross: schema.invoices.gross,
      currency: schema.invoices.currency,
      correctsId: schema.invoices.correctsId,
      contactId: schema.invoices.contactId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id));
  const [row] = sperren ? await abfrage.for("update") : await abfrage;
  if (!row) throw new InvoiceSettlementError("Rechnung nicht gefunden.");
  return row;
}

/** Offener Rest einer Rechnung — dieselbe Definition wie in der Rechnungsliste (listInvoices) */
async function offenerRest(invoiceId: string, tx: Tx): Promise<number> {
  const [row] = await listInvoices(today(), invoiceId, tx);
  return row?.open ?? 0;
}

/**
 * Verrechnet eine Ausgangsrechnung mit ihrer Kundenkorrektur. Der Betrag wird von beiden offenen Resten abgezogen; die
 * Rechnung darf nicht über ihren Rest hinaus bedient werden, die Korrektur darf danach noch ein Guthaben tragen.
 */
export async function settleInvoices(actor: string, input: InvoiceSettlementInput) {
  const parsed = invoiceSettlementSchema.parse(input);
  if (parsed.invoiceId === parsed.counterInvoiceId) throw new InvoiceSettlementError("Eine Rechnung lässt sich nicht mit sich selbst verrechnen.");
  return withActor(actor, async (tx) => {
    // Sperre wie beim Bankabgleich, beide Zeilen in fester Reihenfolge: Zwei gleichzeitige Verrechnungen könnten denselben
    // Rest sonst zweimal verbrauchen, und zwei Aufrufe mit vertauschten Rollen blockierten sich gegenseitig.
    const gesperrt = new Map<string, Awaited<ReturnType<typeof rechnung>>>();
    for (const id of [parsed.invoiceId, parsed.counterInvoiceId].sort()) gesperrt.set(id, await rechnung(tx, id, true));
    const a = gesperrt.get(parsed.invoiceId)!;
    const b = gesperrt.get(parsed.counterInvoiceId)!;
    // Reihenfolge unabhängig davon, von welcher Seite aus verrechnet wird
    const [ziel, korrektur] = a.kind === "korrektur" ? [b, a] : [a, b];
    if (ziel.kind !== "rechnung" || korrektur.kind !== "korrektur" || korrektur.correctsId !== ziel.id) {
      throw new InvoiceSettlementError(
        "Verrechnet werden eine Ausgangsrechnung und ihre eigene Kundenkorrektur; eine Korrektur einer anderen Rechnung oder ein zweiter Beleg gehört nicht dazu.",
      );
    }
    for (const r of [ziel, korrektur]) {
      if (r.status !== "final") {
        throw new InvoiceSettlementError(
          `Die ${r.kind === "korrektur" ? "Korrektur" : "Rechnung"} ist noch ein Entwurf; verrechnet wird nur, was festgeschrieben ist.`,
        );
      }
      // Beträge und Kurse stehen in Euro; in Fremdwährung schuldet der Kunde die Fremdwährung (wie beim Mahnwesen)
      if (r.currency !== "EUR") {
        throw new InvoiceSettlementError(`Verrechnungen für Rechnungen in ${r.currency} unterstützt Haben nicht; bitte den Ausgleich selbst buchen.`);
      }
    }
    const storni = await tx
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.kind, "storno"), eq(schema.invoices.status, "final"), inArray(schema.invoices.correctsId, [ziel.id, korrektur.id])));
    if (storni.length > 0) throw new InvoiceSettlementError("Eine der beiden Rechnungen ist storniert; sie lässt sich nicht verrechnen.");
    const restZiel = await offenerRest(ziel.id, tx);
    const restKorrektur = await offenerRest(korrektur.id, tx);
    if (restZiel <= 0) throw new InvoiceSettlementError("Die Rechnung ist bereits ausgeglichen.");
    if (restKorrektur >= 0) throw new InvoiceSettlementError("Die Korrektur ist bereits erledigt.");
    // Aufhebung des ganzen Belegs ist ein Storno, keine Verrechnung (Entscheidung in #877). Eine Korrektur, die über den
    // Rechnungsbetrag hinausgeht, bleibt dagegen eine Verrechnung: Der Überschuss ist das Guthaben des Kunden.
    if (restZiel === ziel.gross && Math.abs(korrektur.gross) === ziel.gross) {
      throw new InvoiceSettlementError(
        "Eine Korrektur über den vollen, noch unbezahlten Rechnungsbetrag ist ein Storno; storniere die Rechnung, statt sie zu verrechnen.",
      );
    }
    const moeglich = Math.min(restZiel, -restKorrektur);
    if (parsed.amount > moeglich) {
      throw new InvoiceSettlementError(`Mehr als ${formatEuro(moeglich)} lassen sich nicht verrechnen; der Rest bleibt offen.`);
    }
    // Keine Rückwirkung: steuerlich zählt die Aufrechnungserklärung, nicht das Datum der Belege
    const juenger = ziel.issueDate.localeCompare(korrektur.issueDate) >= 0 ? ziel.issueDate : korrektur.issueDate;
    if (parsed.date < juenger) {
      throw new InvoiceSettlementError(
        `Das Datum liegt vor dem jüngeren der beiden Belege (${juenger}). Verrechnet wird an dem Tag, an dem aufgerechnet wird.`,
      );
    }
    const heute = today();
    if (parsed.date > heute) throw new InvoiceSettlementError("Das Datum der Verrechnung liegt in der Zukunft.");
    const settlementId = randomUUID();
    // Betrag mit dem Vorzeichen einer Zahlung: positiv bei der Rechnung, deren offener Rest sinkt, negativ bei der
    // Korrektur, deren Guthaben sich abbaut. Aus den offenen Resten gebildet, nicht aus der Rolle des geöffneten Belegs.
    const rows = await tx
      .insert(schema.invoiceSettlements)
      .values([
        { invoiceId: ziel.id, counterInvoiceId: korrektur.id, settlementId, date: parsed.date, amount: parsed.amount, note: parsed.note, createdBy: actor },
        { invoiceId: korrektur.id, counterInvoiceId: ziel.id, settlementId, date: parsed.date, amount: -parsed.amount, note: parsed.note, createdBy: actor },
      ])
      .returning({ id: schema.invoiceSettlements.id });
    const company = await openBooks(tx);
    const beschreibung = `Verrechnung · Rechnung ${ziel.number} mit Korrektur ${korrektur.number}`;
    for (const [seite, betrag] of [
      [rows[0]!, parsed.amount],
      [rows[1]!, -parsed.amount],
    ] as const) {
      await post(tx, company, {
        date: parsed.date,
        description: beschreibung,
        sourceType: "verrechnung",
        sourceId: seite.id,
        lines: invoiceVerrechnungPosting(betrag, company.kontenrahmen),
      });
    }
    return { ids: rows.map((r) => r.id), amount: parsed.amount, date: parsed.date };
  });
}

/**
 * Gegenbuchung einer Verrechnungsbuchung: dieselben Zeilen, Soll und Haben getauscht, am Tag der Aufhebung. Eine Zeile
 * ohne Buchung bleibt ohne Gegenbuchung; sie lässt sich nicht rückwirkend nachbuchen.
 */
async function storniereVerrechnung(tx: Tx, company: Awaited<ReturnType<typeof openBooks>>, zeileId: string, gegenId: string, date: string): Promise<void> {
  const [original] = await tx
    .select({ id: schema.journalEntries.id, description: schema.journalEntries.description, kontenrahmen: schema.journalEntries.kontenrahmen })
    .from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.sourceType, "verrechnung"), eq(schema.journalEntries.sourceId, zeileId), isNull(schema.journalEntries.reversesId)));
  if (!original) return;
  const zeilen = await tx
    .select({
      account: schema.journalLines.account,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
      taxCode: schema.journalLines.taxCode,
      basis: schema.journalLines.basis,
    })
    .from(schema.journalLines)
    .where(eq(schema.journalLines.entryId, original.id));
  await post(tx, company, {
    date,
    description: `Storno: ${original.description}`,
    sourceType: "verrechnung",
    sourceId: gegenId,
    reversesId: original.id,
    lines: reverseLinesIn(
      original.kontenrahmen as Kontenrahmen,
      company.kontenrahmen,
      zeilen.map((l) => ({ ...l, taxCode: l.taxCode as PostingLine["taxCode"] })),
    ),
  });
}

/**
 * Hebt eine Verrechnung auf: je Zeile eine Gegenzeile mit dem Tag der Aufhebung, nicht dem Tag der Verrechnung — sonst
 * änderte sie die EÜR eines Jahres nachträglich, das schon gemeldet oder festgeschrieben ist.
 */
export async function reverseInvoiceSettlement(actor: string, id: string, date: string, note?: string) {
  const parsed = invoiceSettlementReversalSchema.parse({ id, date, note });
  return withActor(actor, async (tx) => {
    const [gefunden] = await tx
      .select({ settlementId: schema.invoiceSettlements.settlementId })
      .from(schema.invoiceSettlements)
      .where(eq(schema.invoiceSettlements.id, parsed.id));
    if (!gefunden) throw new InvoiceSettlementError("Verrechnung nicht gefunden.");
    const paar = await tx
      .select()
      .from(schema.invoiceSettlements)
      .where(eq(schema.invoiceSettlements.settlementId, gefunden.settlementId))
      .orderBy(asc(schema.invoiceSettlements.id))
      .for("update");
    const row = paar.find((r) => r.id === parsed.id);
    if (!row) throw new InvoiceSettlementError("Verrechnung nicht gefunden.");
    if (row.reversesId) throw new InvoiceSettlementError("Diese Zeile ist bereits eine Gegenzeile.");
    const partner = paar.find((r) => r.id !== row.id && r.reversesId === null);
    if (!partner) throw new InvoiceSettlementError("Zu dieser Verrechnung fehlt die zweite Zeile; sie lässt sich nicht aufheben.");
    const [already] = await tx
      .select({ id: schema.invoiceSettlements.id })
      .from(schema.invoiceSettlements)
      .where(eq(schema.invoiceSettlements.reversesId, row.id));
    if (already) throw new InvoiceSettlementError("Die Verrechnung ist bereits aufgehoben.");
    if (parsed.date < row.date) {
      throw new InvoiceSettlementError(
        `Das Datum liegt vor der Verrechnung (${row.date}). Eine Aufhebung wirkt an dem Tag, an dem sie erklärt wird, nicht rückwirkend.`,
      );
    }
    if (parsed.date > today()) throw new InvoiceSettlementError("Das Datum der Aufhebung liegt in der Zukunft.");
    const aufhebung = (alt: string) => (parsed.note ? `Aufhebung: ${alt} (${parsed.note})` : `Aufhebung: ${alt}`);
    const settlementId = randomUUID();
    const gegen = await tx
      .insert(schema.invoiceSettlements)
      .values([
        {
          invoiceId: row.invoiceId,
          counterInvoiceId: row.counterInvoiceId,
          settlementId,
          date: parsed.date,
          amount: -row.amount,
          note: aufhebung(row.note),
          reversesId: row.id,
          createdBy: actor,
        },
        {
          invoiceId: partner.invoiceId,
          counterInvoiceId: partner.counterInvoiceId,
          settlementId,
          date: parsed.date,
          amount: -partner.amount,
          note: aufhebung(partner.note),
          reversesId: partner.id,
          createdBy: actor,
        },
      ])
      .returning({ id: schema.invoiceSettlements.id });
    const company = await openBooks(tx);
    for (const [i, verrechnung] of [row, partner].entries()) {
      await storniereVerrechnung(tx, company, verrechnung.id, gegen[i]!.id, parsed.date);
    }
    return { ok: true as const, date: parsed.date };
  });
}

/** Verrechnungen einer Rechnung, beide Richtungen, älteste zuerst */
export async function listInvoiceSettlements(invoiceId: string, q: Db | Tx = db) {
  return q
    .select({
      id: schema.invoiceSettlements.id,
      amount: schema.invoiceSettlements.amount,
      date: schema.invoiceSettlements.date,
      note: schema.invoiceSettlements.note,
      reversesId: schema.invoiceSettlements.reversesId,
      counterInvoiceId: schema.invoiceSettlements.counterInvoiceId,
      counterKind: schema.invoices.kind,
      counterNumber: schema.invoices.number,
      counterIssueDate: schema.invoices.issueDate,
      counterGross: schema.invoices.gross,
    })
    .from(schema.invoiceSettlements)
    .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceSettlements.counterInvoiceId))
    .where(eq(schema.invoiceSettlements.invoiceId, invoiceId))
    .orderBy(asc(schema.invoiceSettlements.date), asc(schema.invoiceSettlements.createdAt));
}
