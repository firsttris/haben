import { DEFAULT_INVOICE_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT, formatDocumentNumber } from "@haben/core";
import { withActor } from "../../db/actor.ts";
import { db, schema } from "../../db/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { InvoiceError } from "./invoice-error.ts";
import { circleFor, countsRunning, lastNumber, setNextNumber as setNextCounter, type NumberKind } from "./number-counter.ts";

/* Nummernkreise von Rechnung und Angebot: nächste Nummer anzeigen und setzen */

const NUMBER_FORMAT = { rechnung: "invoiceNumberFormat", angebot: "quoteNumberFormat" } as const;

/**
 * Nächste Nummer eines Kreises für ein Datum (heute), z. B. um nach Lexoffice oder sevDesk nahtlos weiterzuzählen.
 * Mit durchlaufendem Zähler ist es der eine Kreis 0, sonst das Jahr (#328).
 */
export async function numbering(date: string, kind: NumberKind = "rechnung") {
  const company = await loadCompany();
  const { running, circle, last } = await db.transaction(async (tx) => {
    const running = await countsRunning(tx, kind);
    const circle = running ? 0 : Number(date.slice(0, 4));
    return { running, circle, last: await lastNumber(tx, kind, circle) };
  });
  return { kind, date, year: Number(date.slice(0, 4)), running, circle, last, next: formatDocumentNumber(company[NUMBER_FORMAT[kind]], date, last + 1) };
}

export async function setNextNumber(actor: string, date: string, next: number, kind: NumberKind = "rechnung") {
  const result = await withActor(actor, async (tx) => {
    const set = await setNextCounter(tx, kind, await circleFor(tx, kind, date), next);
    if (set.ok) return set;
    // Nur lesen: loadCompany legte die Firmenzeile an, wenn sie fehlt, und das gehört nicht in eine Fehlermeldung
    const [company] = await tx.select({ invoice: schema.company.invoiceNumberFormat, quote: schema.company.quoteNumberFormat }).from(schema.company);
    const fallback = kind === "rechnung" ? DEFAULT_INVOICE_NUMBER_FORMAT : DEFAULT_QUOTE_NUMBER_FORMAT;
    return { ...set, format: (kind === "rechnung" ? company?.invoice : company?.quote) ?? fallback };
  });
  if (!result.ok) throw new InvoiceError(`Die nächste Nummer muss größer als ${formatDocumentNumber(result.format, date, result.last)} sein.`);
}
