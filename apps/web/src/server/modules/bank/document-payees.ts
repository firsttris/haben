import { compactIban, geltendeIban, type IbanEntscheidung } from "@haben/core";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";

/** Woher Haben das Konto eines Lieferanten kennt */
export interface DocumentPayee {
  /** IBAN aus dem Kontakt des Lieferanten */
  contactIban: string | null;
  /** IBAN aus der E-Rechnung (BT-84) */
  einvoiceIban: string | null;
  /** Zahlungsbedingungen der E-Rechnung (BT-20), darin ggf. Skonto */
  paymentTerms: string | null;
  /** EndToEndIds der SEPA-Überweisungen, die Haben für den Beleg erzeugt hat */
  references: string[];
  /** IBANs, auf die diese Überweisungen gingen */
  transferIbans: string[];
}

const blankToNull = (value: string | null | undefined) => (value && value.trim() !== "" ? compactIban(value) : null);

/**
 * Konto und Überweisungsreferenzen je Beleg: für die SEPA-Datei und für die Zuordnung im Bankabgleich. Die E-Rechnung
 * steht so, wie sie gelesen wurde, in `documents.extraction` (IncomingInvoice aus @haben/einvoice).
 */
export async function documentPayees(ids: string[], q: Db | Tx = db): Promise<Map<string, DocumentPayee>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({
      id: schema.documents.id,
      contactIban: schema.contacts.iban,
      einvoiceIban: sql<
        string | null
      >`case when ${schema.documents.extractedBy} in ('zugferd', 'xrechnung') then ${schema.documents.extraction} ->> 'iban' end`,
      paymentTerms: sql<
        string | null
      >`case when ${schema.documents.extractedBy} in ('zugferd', 'xrechnung') then ${schema.documents.extraction} ->> 'paymentTerms' end`,
    })
    .from(schema.documents)
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.documents.supplierContactId))
    .where(inArray(schema.documents.id, ids));
  const items = await q
    .select({ documentId: schema.sepaTransferItems.documentId, endToEndId: schema.sepaTransferItems.endToEndId, iban: schema.sepaTransferItems.creditorIban })
    .from(schema.sepaTransferItems)
    .where(inArray(schema.sepaTransferItems.documentId, ids));
  return new Map(
    rows.map((r) => {
      const own = items.filter((i) => i.documentId === r.id);
      return [
        r.id,
        {
          contactIban: blankToNull(r.contactIban),
          einvoiceIban: blankToNull(r.einvoiceIban),
          paymentTerms: r.paymentTerms,
          references: own.map((i) => i.endToEndId),
          transferIbans: [...new Set(own.map((i) => i.iban))],
        },
      ];
    }),
  );
}

/** Entscheidungen je Beleg, mit dem Namen der Person (sonst ihrer Kennung) */
export async function ibanDecisions(ids: string[], q: Db | Tx = db): Promise<Map<string, IbanEntscheidung[]>> {
  if (ids.length === 0) return new Map();
  const rows = await q
    .select({
      documentId: schema.documentIbanDecisions.documentId,
      kontaktIban: schema.documentIbanDecisions.kontaktIban,
      rechnungsIban: schema.documentIbanDecisions.rechnungsIban,
      wahl: schema.documentIbanDecisions.wahl,
      am: schema.documentIbanDecisions.createdAt,
      decidedBy: schema.documentIbanDecisions.decidedBy,
      name: schema.user.name,
    })
    .from(schema.documentIbanDecisions)
    .leftJoin(schema.user, eq(schema.user.id, schema.documentIbanDecisions.decidedBy))
    .where(inArray(schema.documentIbanDecisions.documentId, ids));
  const map = new Map<string, IbanEntscheidung[]>();
  for (const { documentId, decidedBy, name, ...e } of rows) map.set(documentId, [...(map.get(documentId) ?? []), { ...e, von: name ?? decidedBy }]);
  return map;
}

/**
 * IBANs, die der Bankabgleich als IBAN des Lieferanten wertet: die des Kontakts, die der E-Rechnung nur nach derselben
 * Regel wie für die SEPA-Datei (geltendeIban, #410), und die IBANs tatsächlich erzeugter Überweisungen. Eine abweichende
 * oder unbestätigte IBAN aus der E-Rechnung soll eine Zahlung auf ein ausgetauschtes Konto nicht vertrauenswürdig
 * aussehen lassen (#486).
 */
export function payeeIbans(payee: DocumentPayee | undefined, decisions: IbanEntscheidung[]): string[] {
  if (!payee) return [];
  const geltend = geltendeIban({ kontaktIban: payee.contactIban, rechnungsIban: payee.einvoiceIban }, decisions).iban;
  return [...new Set([payee.contactIban, geltend, ...payee.transferIbans].filter((i): i is string => i !== null))];
}
