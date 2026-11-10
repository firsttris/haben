import { randomBytes } from "node:crypto";
import {
  documentOpen,
  formatDecimal,
  geltendeIban,
  type IbanEntscheidung,
  isEwrIban,
  isValidIban,
  pain001,
  parseSkontoTerms,
  skontoOffer,
  type Cents,
  type SepaTransaction,
  type SkontoTerm,
} from "@haben/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { documentNotCancelled } from "../../db/document-cancelled.ts";
import { db, schema } from "../../db/index.ts";
import { today } from "../../today.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { BankError, documentPayments } from "./bank.ts";
import { documentPayees, ibanDecisions, type DocumentPayee } from "./document-payees.ts";

/** Ein offener Beleg, der sich überweisen lässt, oder warum nicht */
export interface TransferCandidate {
  documentId: string;
  supplierName: string;
  invoiceNumber: string;
  documentDate: string | null;
  dueDate: string | null;
  /** Noch zu zahlen, positiv */
  open: Cents;
  iban: string | null;
  ibanSource: "kontakt" | "e-rechnung" | null;
  /** Warum der Beleg nicht in die Datei kann: IBAN fehlt oder ist ungültig, Fremdwährung */
  problem: string | null;
  /** Hinweis, der die Überweisung nicht verhindert */
  warning: string | null;
  /** Die E-Rechnung nennt eine andere IBAN als der Kontakt, und am Beleg ist nicht entschieden, welche gilt (#410) */
  ibanDecisionNeeded: boolean;
  /** Skonto aus der E-Rechnung, nur wenn es sich später als erhaltenes Skonto buchen lässt */
  skontoTerms: SkontoTerm[];
  /** Früher erzeugte Überweisungen für diesen Beleg */
  transfers: { createdAt: Date; executionDate: string; amount: Cents }[];
}

/**
 * Konto des Lieferanten: Kontakt, sonst die E-Rechnung. Nennt die E-Rechnung eine andere IBAN als der Kontakt, ist das
 * ein bekanntes Muster für Betrug (ausgetauschte Bankverbindung); dann gilt erst die am Beleg entschiedene (#410).
 */
function payeeAccount(
  payee: DocumentPayee | undefined,
  decisions: IbanEntscheidung[],
): Pick<TransferCandidate, "iban" | "ibanSource" | "problem" | "warning" | "ibanDecisionNeeded"> {
  const geltend = geltendeIban({ kontaktIban: payee?.contactIban ?? null, rechnungsIban: payee?.einvoiceIban ?? null }, decisions);
  if (geltend.iban === null) {
    const problem = !geltend.offen
      ? "IBAN fehlt: im Kontakt des Lieferanten eintragen"
      : payee?.contactIban
        ? "Die E-Rechnung nennt eine andere IBAN als der Kontakt: am Beleg entscheiden, welche gilt"
        : "Die IBAN aus der E-Rechnung ist noch nicht bestätigt: am Beleg übernehmen";
    return { iban: null, ibanSource: null, problem, warning: null, ibanDecisionNeeded: geltend.offen === true };
  }
  const { iban, herkunft: ibanSource } = geltend;
  const problem = !isValidIban(iban)
    ? `IBAN ${iban} ist ungültig (${ibanSource === "kontakt" ? "Kontakt" : "E-Rechnung"})`
    : !isEwrIban(iban)
      ? `IBAN ${iban} liegt außerhalb des EWR: bitte direkt im Online-Banking überweisen`
      : null;
  const warning = geltend.entschieden
    ? `Am Beleg entschieden: ${ibanSource === "kontakt" ? "IBAN des Kontakts" : "IBAN der E-Rechnung nur für diesen Beleg"}`
    : null;
  return { iban, ibanSource, problem, warning, ibanDecisionNeeded: false };
}

/** Offene Belege, die per Bank bezahlt werden, mit Konto des Lieferanten; älteste Fälligkeit zuerst */
export async function transferCandidates(): Promise<TransferCandidate[]> {
  const documents = await db
    .select({
      id: schema.documents.id,
      supplierName: schema.documents.supplierName,
      invoiceNumber: schema.documents.invoiceNumber,
      documentDate: schema.documents.documentDate,
      dueDate: schema.documents.dueDate,
      gross: schema.documents.gross,
      currency: schema.documents.currency,
      reverseCharge: schema.documents.reverseCharge,
      privateShare: schema.documents.privateShare,
      category: schema.documents.category,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.status, "gebucht"), eq(schema.documents.payment, "bank"), documentNotCancelled()));
  const ids = documents.map((d) => d.id);
  const [paid, payees, transfers, decisions] = await Promise.all([documentPayments(ids), documentPayees(ids), transfersByDocument(ids), ibanDecisions(ids)]);
  return documents
    .map((doc) => {
      const paidSoFar = paid.get(doc.id) ?? 0;
      const open = -documentOpen(doc.gross, paidSoFar);
      const payee = payees.get(doc.id);
      const account = payeeAccount(payee, decisions.get(doc.id) ?? []);
      // Erhaltenes Skonto bucht Haben nur ohne § 13b, Privatanteil und Anlagegut (bank.ts, writeOff); angeboten nur auf einen noch ganz offenen Beleg
      const skontoAllowed = paidSoFar === 0 && doc.reverseCharge === null && doc.privateShare === 0 && doc.category !== "anlage" && doc.documentDate !== null;
      return {
        documentId: doc.id,
        supplierName: doc.supplierName,
        invoiceNumber: doc.invoiceNumber,
        documentDate: doc.documentDate,
        dueDate: doc.dueDate,
        open,
        ...account,
        problem:
          doc.currency !== "EUR"
            ? `Rechnung in ${doc.currency}: SEPA überweist nur Euro`
            : doc.supplierName.trim() === ""
              ? "Name des Lieferanten fehlt am Beleg"
              : account.problem,
        skontoTerms: skontoAllowed && payee?.paymentTerms ? parseSkontoTerms(payee.paymentTerms) : [],
        transfers: transfers.get(doc.id) ?? [],
      };
    })
    .filter((c) => c.open > 0)
    .sort((a, b) => (a.dueDate ?? a.documentDate ?? "").localeCompare(b.dueDate ?? b.documentDate ?? ""));
}

async function transfersByDocument(ids: string[]): Promise<Map<string, TransferCandidate["transfers"]>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      documentId: schema.sepaTransferItems.documentId,
      createdAt: schema.sepaTransfers.createdAt,
      executionDate: schema.sepaTransfers.executionDate,
      amount: schema.sepaTransferItems.amount,
    })
    .from(schema.sepaTransferItems)
    .innerJoin(schema.sepaTransfers, eq(schema.sepaTransfers.id, schema.sepaTransferItems.transferId))
    .where(inArray(schema.sepaTransferItems.documentId, ids))
    .orderBy(desc(schema.sepaTransfers.createdAt));
  const map = new Map<string, TransferCandidate["transfers"]>();
  for (const { documentId, ...transfer } of rows) map.set(documentId, [...(map.get(documentId) ?? []), transfer]);
  return map;
}

export const sepaTransferSchema = z.object({
  bankAccountId: z.uuid(),
  executionDate: z.iso.date(),
  items: z
    .array(z.object({ documentId: z.uuid(), skonto: z.boolean().default(false) }))
    .min(1, "Keinen Beleg ausgewählt")
    .max(500)
    .refine((items) => new Set(items.map((i) => i.documentId)).size === items.length, "Ein Beleg ist doppelt ausgewählt"),
});

export type SepaTransferInput = z.infer<typeof sepaTransferSchema>;

/** Kennung der Datei und der Überweisungen: HABEN- und 16 Hex-Ziffern, im Zeichensatz des Schemas und eindeutig */
const newId = () => `HABEN-${randomBytes(8).toString("hex").toUpperCase()}`;

const berlinTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Verwendungszweck: Rechnungsnummer des Lieferanten, sonst das Datum; mit Skonto der Abzug, damit der Lieferant ihn sieht */
function remittanceFor(c: TransferCandidate, skonto: { percent: number; amount: Cents } | null): string {
  const [year, month, day] = (c.documentDate ?? "").split("-");
  const reference = c.invoiceNumber.trim() || (c.documentDate ? `Rechnung vom ${day}.${month}.${year}` : "Rechnung");
  if (!skonto) return reference;
  const percent = (skonto.percent / 100).toFixed(2).replace(".", ",");
  return `${reference} abzgl. ${percent} Prozent Skonto ${formatDecimal(skonto.amount)} EUR`;
}

/**
 * Erzeugt die pain.001-Datei für die gewählten Belege und hält sie fest (sepa_transfers, sepa_transfer_items). Gebucht
 * wird nichts: Die Belege bleiben offen, bis der Bankabgleich die Abbuchung zuordnet; die EndToEndId hilft ihm dabei.
 */
export async function createSepaTransfer(actor: string, input: SepaTransferInput, now = new Date()): Promise<{ id: string; filename: string }> {
  if (input.executionDate < today(now)) throw new BankError("Das Ausführungsdatum liegt in der Vergangenheit.");
  const [account] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.id, input.bankAccountId));
  if (!account?.iban || account.purpose === "zahlungsdienstleister") throw new BankError("Bitte ein Bankkonto mit IBAN als Auftraggeberkonto wählen.");
  if (account.excludedAt) throw new BankError(`${account.name} ist ausgeschlossen und kann nicht Auftraggeberkonto sein.`);
  const company = await loadCompany();
  const debtorName = (company.kontoinhaber || company.name).trim();
  if (debtorName === "") throw new BankError("Der Firmenname fehlt in den Einstellungen; er steht als Auftraggeber in der Datei.");

  const candidates = new Map((await transferCandidates()).map((c) => [c.documentId, c]));
  const problems: string[] = [];
  const planned = input.items.flatMap((item) => {
    const c = candidates.get(item.documentId);
    if (!c) {
      problems.push("Ein gewählter Beleg ist nicht mehr offen.");
      return [];
    }
    if (c.problem || !c.iban) {
      problems.push(`${c.supplierName || "Beleg"}: ${c.problem}`);
      return [];
    }
    const offer = item.skonto && c.documentDate ? skontoOffer(c.skontoTerms, c.documentDate, input.executionDate, c.open) : null;
    if (item.skonto && !offer) problems.push(`${c.supplierName || "Beleg"}: Skonto ist zum Ausführungsdatum nicht mehr möglich`);
    const skonto = offer ? { percent: offer.term.percent, amount: offer.amount } : null;
    const transaction: SepaTransaction = {
      endToEndId: newId(),
      amount: c.open - (skonto?.amount ?? 0),
      creditor: { name: c.supplierName, iban: c.iban },
      remittance: remittanceFor(c, skonto),
    };
    return [{ documentId: c.documentId, skonto: skonto?.amount ?? 0, transaction }];
  });
  if (problems.length > 0) throw new BankError(problems.join(" "));

  const messageId = newId();
  const result = pain001({
    messageId,
    paymentInfoId: `${messageId}-1`,
    createdAt: berlinTime.format(now).replace(" ", "T"),
    executionDate: input.executionDate,
    // BIC nur, wenn sie in den Firmendaten zu genau diesem Konto steht; sonst NOTPROVIDED
    debtor: { name: debtorName, iban: account.iban, bic: company.iban.replace(/\s+/g, "").toUpperCase() === account.iban ? company.bic : undefined },
    transactions: planned.map((p) => p.transaction),
  });
  if (!result.ok) throw new BankError(result.problems.join("; "));

  const id = await withActor(actor, async (tx) => {
    const [transfer] = await tx
      .insert(schema.sepaTransfers)
      .values({
        bankAccountId: account.id,
        messageId,
        executionDate: input.executionDate,
        numberOfTransactions: result.numberOfTransactions,
        controlSum: result.controlSum,
        xml: result.xml,
      })
      .returning({ id: schema.sepaTransfers.id });
    await tx.insert(schema.sepaTransferItems).values(
      planned.map((p) => ({
        transferId: transfer!.id,
        documentId: p.documentId,
        endToEndId: p.transaction.endToEndId,
        amount: p.transaction.amount,
        skonto: p.skonto,
        creditorName: p.transaction.creditor.name,
        creditorIban: p.transaction.creditor.iban,
        remittance: p.transaction.remittance,
      })),
    );
    return transfer!.id;
  });
  return { id, filename: `${messageId}.xml` };
}

/** Erzeugte Dateien, neueste zuerst */
export async function listSepaTransfers(limit = 50) {
  return db
    .select({
      id: schema.sepaTransfers.id,
      messageId: schema.sepaTransfers.messageId,
      executionDate: schema.sepaTransfers.executionDate,
      numberOfTransactions: schema.sepaTransfers.numberOfTransactions,
      controlSum: schema.sepaTransfers.controlSum,
      createdAt: schema.sepaTransfers.createdAt,
      accountName: schema.bankAccounts.name,
    })
    .from(schema.sepaTransfers)
    .innerJoin(schema.bankAccounts, eq(schema.bankAccounts.id, schema.sepaTransfers.bankAccountId))
    .orderBy(desc(schema.sepaTransfers.createdAt))
    .limit(limit);
}

/** Die Datei zum erneuten Herunterladen */
export async function sepaTransferFile(id: string): Promise<{ xml: string; filename: string } | null> {
  const [row] = await db
    .select({ xml: schema.sepaTransfers.xml, messageId: schema.sepaTransfers.messageId })
    .from(schema.sepaTransfers)
    .where(eq(schema.sepaTransfers.id, id));
  return row ? { xml: row.xml, filename: `${row.messageId}.xml` } : null;
}

/** Vermerk am Beleg: wann für ihn eine Überweisung erzeugt wurde */
export async function documentSepaTransfers(documentId: string) {
  return db
    .select({
      transferId: schema.sepaTransfers.id,
      createdAt: schema.sepaTransfers.createdAt,
      executionDate: schema.sepaTransfers.executionDate,
      amount: schema.sepaTransferItems.amount,
      skonto: schema.sepaTransferItems.skonto,
      endToEndId: schema.sepaTransferItems.endToEndId,
    })
    .from(schema.sepaTransferItems)
    .innerJoin(schema.sepaTransfers, eq(schema.sepaTransfers.id, schema.sepaTransferItems.transferId))
    .where(eq(schema.sepaTransferItems.documentId, documentId))
    .orderBy(desc(schema.sepaTransfers.createdAt));
}
