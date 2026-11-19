import { randomUUID } from "node:crypto";
import { formatEuro, verrechnungPosting, type Kontenrahmen, type PostingLine, inCents } from "@haben/core";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withActor } from "../../db/actor.ts";
import { schema, type Tx } from "../../db/index.ts";
import { UserError } from "../../errors.ts";
import { today } from "../../today.ts";
import { openBooks, post, reverseLinesIn } from "../buchhaltung/index.ts";
import { settledOn } from "./settled-amounts.ts";
import { belegTotals, freigabeNachziehen } from "../umsatzsteuer/index.ts";
import { vorsteuerAusgleich } from "./vorsteuer-ausgleich.ts";
import { lieferant } from "./verrechnung-abfragen.ts";

export { listSettlements, openAmount, settlementCandidates } from "./verrechnung-abfragen.ts";

/*
 * Verrechnung zweier Eingangsbelege ohne Zahlung (#274): eine Gutschrift des Lieferanten gleicht eine
 * oder mehrere Rechnungen aus. Beide Belege bleiben erhalten, es entsteht kein Bankumsatz und kein
 * Kassenstand ändert sich. Je Verrechnung zwei Zeilen in `document_settlements`, damit jede Seite für
 * sich als erledigt zählt; aufgehoben wird per Gegenzeile wie bei den Ausbuchungen.
 *
 * Gebucht wird je Belegseite eine eigene Buchung, jede mit ihrem Beleg (source_type 'verrechnung',
 * source_id der Zeile in `document_settlements`): Verbindlichkeiten gegen das Verrechnungskonto. Erst damit
 * trägt die Verrechnung einen Vorgangsbezug, den der DATEV-Export für das Personenkonto braucht; eine
 * gemeinsame Sammelbuchung über zwei Belege (früher #785) hätte ihn nicht. Jede Seite, deren Beleg Vorsteuer auf dem
 * Zwischenkonto hat (Gutschrift „erstattet bereits Bezahltes“, #786; Leistung nach dem Belegdatum, #693), trägt
 * zusätzlich die Umbuchung der Vorsteuer.
 *
 * Beide Zeilen einer Verrechnung tragen dieselbe `settlement_id`: Aufheben trifft damit genau dieses Paar,
 * auch wenn zwischen denselben Belegen mehrfach derselbe Betrag verrechnet wurde. Die Gegenzeilen einer
 * Aufhebung bilden ihrerseits ein Paar mit eigener Kennung.
 */

export const settlementSchema = z.object({
  /** Beleg, von dem aus verrechnet wird (in der Oberfläche der gerade offene) */
  documentId: z.uuid(),
  /** Der Gegenbeleg, etwa die Gutschrift des Lieferanten */
  counterDocumentId: z.uuid(),
  /** Betrag ohne Vorzeichen; die Richtung ergibt sich aus den offenen Resten */
  amount: inCents(z.number().int().positive()),
  /** Tag der Aufrechnung; verrechnet wird, wenn aufgerechnet wird, nicht rückwirkend */
  date: z.iso.date(),
  /** Grund der Verrechnung, etwa die Nummer der Gutschrift */
  note: z.string().trim().min(1, "Bitte den Grund der Verrechnung angeben.").max(500),
});

/** Aufhebung einer Verrechnung: Pflicht ist der Tag, an dem sie erklärt wird */
export const reversalSchema = z.object({
  /** Zeile der Verrechnung, die aufgehoben wird */
  id: z.uuid(),
  /** Tag der Aufhebung; sie wirkt an diesem Tag, nicht rückwirkend */
  date: z.iso.date(),
  /** Ergänzung zur Aufhebung, etwa der Grund */
  note: z.string().trim().max(500).optional(),
});

export type SettlementInput = z.input<typeof settlementSchema>;

export class SettlementError extends UserError {}

/** Ein Beleg, wie ihn Verrechnung und Aufhebung brauchen; `sperren` nimmt die Zeilensperre der Transaktion */
async function beleg(tx: Tx, id: string, sperren = false) {
  const abfrage = tx
    .select({
      id: schema.documents.id,
      documentDate: schema.documents.documentDate,
      supplier: schema.documents.supplierName,
      invoiceNumber: schema.documents.invoiceNumber,
      filename: schema.documents.filename,
      net: schema.documents.net,
      tax: schema.documents.tax,
      gross: schema.documents.gross,
      payment: schema.documents.payment,
      status: schema.documents.status,
      privateShare: schema.documents.privateShare,
      erstattetBezahltes: schema.documents.erstattetBezahltes,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  const [row] = sperren ? await abfrage.for("update") : await abfrage;
  if (!row) throw new SettlementError("Beleg nicht gefunden.");
  return row;
}

/** Abgeschlossene Jahre nehmen keine Verrechnung mehr an, so wie das Hauptbuch keine Buchung mehr (ledger.post) */
async function pruefeJahrOffen(tx: Tx, date: string) {
  const jahr = Number(date.slice(0, 4));
  const [closed] = await tx.select({ year: schema.yearClosings.year }).from(schema.yearClosings).where(eq(schema.yearClosings.year, jahr));
  if (closed) throw new SettlementError(`Das Jahr ${jahr} ist abgeschlossen; Verrechnungen mit Datum darin sind nicht mehr möglich.`);
}

/**
 * Prüft, ob sich die beiden gesperrten Belege so verrechnen lassen, und gibt ihre offenen Reste zurück (mit Vorzeichen:
 * negativ bei der Gutschrift).
 */
async function pruefeVerrechnung(
  tx: Tx,
  a: Awaited<ReturnType<typeof beleg>>,
  b: Awaited<ReturnType<typeof beleg>>,
  parsed: z.output<typeof settlementSchema>,
): Promise<{ restA: number; restB: number }> {
  for (const d of [a, b]) {
    if (d.status !== "gebucht") throw new SettlementError(`Beleg ${d.documentDate ?? ""} ist nicht gebucht.`);
    if (d.payment !== "bank") throw new SettlementError(`Beleg ${d.documentDate ?? ""} läuft nicht über die Bank und hat keinen offenen Posten.`);
  }
  // Eine Gutschrift gleicht nur Belege desselben Lieferanten aus (docs/belege-bezahlen.md); die Kandidatenliste filtert danach,
  // der Server muss es selbst prüfen.
  const nameA = lieferant(a.supplier);
  const nameB = lieferant(b.supplier);
  if (!nameA || !nameB) {
    throw new SettlementError("Bei einem der Belege fehlt der Lieferant; ohne ihn lässt sich nicht prüfen, ob die Gutschrift dazugehört.");
  }
  if (nameA !== nameB) {
    throw new SettlementError(
      `Die Belege stammen von verschiedenen Lieferanten (${a.supplier} und ${b.supplier}); eine Gutschrift gleicht nur Belege desselben Lieferanten aus.`,
    );
  }
  const storniert = await tx
    .select({ id: schema.documentCancellations.documentId })
    .from(schema.documentCancellations)
    .where(inArray(schema.documentCancellations.documentId, [a.id, b.id]));
  if (storniert.length > 0) throw new SettlementError("Ein Beleg ist storniert und lässt sich nicht verrechnen.");
  const restA = (a.gross ?? 0) + (await settledOn(tx, "document_id", a.id));
  const restB = (b.gross ?? 0) + (await settledOn(tx, "document_id", b.id));
  if (restA === 0 || restB === 0) throw new SettlementError("Einer der Belege ist bereits ausgeglichen.");
  if (Math.sign(restA) === Math.sign(restB)) {
    throw new SettlementError("Beide Belege zeigen in dieselbe Richtung; zu verrechnen sind eine Rechnung und eine Gutschrift.");
  }
  const moeglich = Math.min(Math.abs(restA), Math.abs(restB));
  if (parsed.amount > moeglich) {
    throw new SettlementError(`Mehr als ${formatEuro(moeglich)} lassen sich nicht verrechnen.`);
  }
  const datumA = a.documentDate ?? "";
  const datumB = b.documentDate ?? "";
  // Math.max taugt hier nicht: es rechnet die Datumsstrings in Zahlen um und ergibt NaN
  const juenger = datumA.localeCompare(datumB) >= 0 ? datumA : datumB;
  if (parsed.date < juenger) {
    throw new SettlementError(
      `Das Datum liegt vor dem jüngeren der beiden Belege (${juenger}). Steuerlich zählt die Aufrechnungserklärung, nicht eine Rückwirkung.`,
    );
  }
  if (parsed.date > today()) throw new SettlementError("Das Datum der Verrechnung liegt in der Zukunft.");
  await pruefeJahrOffen(tx, parsed.date);
  return { restA, restB };
}

/**
 * Verrechnet zwei Belege gegeneinander. Der Betrag wird von beiden offenen Resten abgezogen, keiner
 * der beiden darf dadurch umschlagen. Für eine Gutschrift (negativer Beleg) ist der offene Rest
 * negativ; die Zeile bekommt dann ein positives Vorzeichen.
 */
export async function settleDocuments(actor: string, input: SettlementInput) {
  const parsed = settlementSchema.parse(input);
  if (parsed.documentId === parsed.counterDocumentId) throw new SettlementError("Ein Beleg lässt sich nicht mit sich selbst verrechnen.");
  return withActor(actor, async (tx) => {
    // Sperre wie beim Bankabgleich: Zwei gleichzeitige Verrechnungen könnten denselben Rest sonst zweimal verbrauchen.
    // Beide Belege in fester Reihenfolge sperren, sonst blockieren sich zwei Aufrufe mit vertauschten Rollen gegenseitig.
    const gesperrt = new Map<string, Awaited<ReturnType<typeof beleg>>>();
    for (const id of [parsed.documentId, parsed.counterDocumentId].sort()) gesperrt.set(id, await beleg(tx, id, true));
    const a = gesperrt.get(parsed.documentId)!;
    const b = gesperrt.get(parsed.counterDocumentId)!;
    const { restA, restB } = await pruefeVerrechnung(tx, a, b, parsed);
    const date = parsed.date;
    // Gemeinsame Kennung für beide Zeilen: die Aufhebung findet das Paar damit eindeutig
    const settlementId = randomUUID();
    const company = await openBooks(tx);
    // Betrag je Seite mit dem Vorzeichen der Zeile in document_settlements: negativ bei der Rechnung, deren
    // Verbindlichkeit sinkt, positiv bei der Gutschrift. Aus dem offenen Rest, nicht aus der Rolle des Belegs: sonst
    // wäre es falsch, sobald der geöffnete Beleg die Gutschrift ist (negativer Rest) und der Rest wüchse auf beiden Seiten.
    const betraege = [-Math.sign(restA) * parsed.amount, -Math.sign(restB) * parsed.amount];
    // Vorsteuer vom Zwischenkonto auf die Vorsteuer: geparkte Vorsteuer einer noch nicht ausgeführten Leistung (#693)
    // und eine Gutschrift „erstattet bereits Bezahltes“ (#786). Die Aufrechnung steht der Zahlung gleich: Sie macht den
    // Anteil vor der Ausführung abziehbar (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 3 UStG) bzw. mindert die Vorsteuer der Gutschrift
    // (§ 17 Abs. 1 Satz 2 und 8 UStG); ohne Buchung auf dem Zwischenkonto kommt nichts dazu. Die Zeilen stehen vor dem
    // Einfügen der Verrechnung fest: sonst zählte der verrechnete Betrag schon als erledigt.
    const steuer: PostingLine[][] = [];
    for (const [seite, doc] of [a, b].entries()) {
      steuer.push(await vorsteuerAusgleich(tx, doc, await belegTotals(tx, doc), betraege[seite]!, company.kontenrahmen, date));
    }
    const rows = await tx
      .insert(schema.documentSettlements)
      .values([
        { documentId: a.id, counterDocumentId: b.id, settlementId, date, amount: betraege[0]!, note: parsed.note, createdBy: actor },
        { documentId: b.id, counterDocumentId: a.id, settlementId, date, amount: betraege[1]!, note: parsed.note, createdBy: actor },
      ])
      .returning({ id: schema.documentSettlements.id });
    // Zwei Buchungen, je Belegseite eine (#786): Die Zeile in document_settlements ist ihre Quelle, damit der DATEV-Export
    // den Beleg und daran das Personenkonto findet. Die Steuerzeilen eines Belegs stehen in derselben Buchung; so dreht
    // eine Aufhebung beide zusammen um.
    for (const [seite, doc] of [a, b].entries()) {
      await post(tx, company, {
        date,
        description: `Verrechnung · Beleg ${doc.invoiceNumber || doc.filename} · ${doc.supplier}`,
        sourceType: "verrechnung",
        sourceId: rows[seite]!.id,
        lines: [...verrechnungPosting(betraege[seite]!, company.kontenrahmen), ...steuer[seite]!],
      });
    }
    // Verrechnung vor der Ausführung (#693): was noch wartet, bleibt zum Ausführungsdatum freigegeben
    for (const doc of [a, b]) await freigabeNachziehen(tx, doc.id, company, date);
    return { ids: rows.map((r) => r.id), amount: parsed.amount, date };
  });
}

/**
 * Gegenbuchung einer Verrechnungsbuchung (#786): dieselben Zeilen, Soll und Haben getauscht, am Tag der Aufhebung. Eine
 * Buchung von vor dieser Etappe (nur die Umbuchung der Vorsteuer) wird genauso umgedreht; eine Verrechnung ganz ohne
 * Buchung bleibt ohne Gegenbuchung, sie lässt sich nicht rückwirkend nachbuchen.
 */
async function storniereVerrechnung(
  tx: Tx,
  company: Awaited<ReturnType<typeof openBooks>>,
  verrechnungId: string,
  gegenId: string,
  date: string,
): Promise<void> {
  const [original] = await tx
    .select({ id: schema.journalEntries.id, description: schema.journalEntries.description, kontenrahmen: schema.journalEntries.kontenrahmen })
    .from(schema.journalEntries)
    .where(
      and(eq(schema.journalEntries.sourceType, "verrechnung"), eq(schema.journalEntries.sourceId, verrechnungId), isNull(schema.journalEntries.reversesId)),
    );
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
 * Hebt eine Verrechnung auf: je Zeile eine Gegenzeile, wie bei den Ausbuchungen. Die Gegenzeilen tragen den Tag der
 * Aufhebung, nicht den der Verrechnung: Eine Aufhebung wirkt wie jede Storno-Buchung an dem Tag, an dem sie erklärt wird.
 * Sonst änderte sie die EÜR eines Jahres nachträglich, das schon gemeldet oder festgeschrieben ist.
 */
export async function reverseSettlement(actor: string, id: string, date: string, note?: string) {
  const parsed = reversalSchema.parse({ id, date, note });
  return withActor(actor, async (tx) => {
    // Erst die Paar-Kennung lesen, dann beide Zeilen des Paars in fester Reihenfolge sperren: so treffen sich zwei
    // gleichzeitige Aufhebungen nicht im Kreis und die Aufhebung trifft genau diese Verrechnung.
    const [gefunden] = await tx
      .select({ settlementId: schema.documentSettlements.settlementId })
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.id, parsed.id));
    if (!gefunden) throw new SettlementError("Verrechnung nicht gefunden.");
    const paar = await tx
      .select()
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.settlementId, gefunden.settlementId))
      .orderBy(asc(schema.documentSettlements.id))
      .for("update");
    const row = paar.find((r) => r.id === parsed.id);
    if (!row) throw new SettlementError("Verrechnung nicht gefunden.");
    if (row.reversesId) throw new SettlementError("Diese Zeile ist bereits eine Gegenzeile.");
    const partner = paar.find((r) => r.id !== row.id && r.reversesId === null);
    if (!partner) throw new SettlementError("Zu dieser Verrechnung fehlt die zweite Zeile; sie lässt sich nicht aufheben.");
    const [already] = await tx
      .select({ id: schema.documentSettlements.id })
      .from(schema.documentSettlements)
      .where(eq(schema.documentSettlements.reversesId, row.id));
    if (already) throw new SettlementError("Die Verrechnung ist bereits aufgehoben.");
    // Wie beim Verrechnen: keine Rückwirkung, keine Zukunft
    if (parsed.date < row.date) {
      throw new SettlementError(
        `Das Datum liegt vor der Verrechnung (${row.date}). Eine Aufhebung wirkt an dem Tag, an dem sie erklärt wird, nicht rückwirkend.`,
      );
    }
    if (parsed.date > today()) throw new SettlementError("Das Datum der Aufhebung liegt in der Zukunft.");
    await pruefeJahrOffen(tx, parsed.date);
    /** Notiz der Gegenzeile: sie nennt die Aufhebung und, wenn angegeben, den Grund */
    const aufhebung = (alt: string) => (parsed.note ? `Aufhebung: ${alt} (${parsed.note})` : `Aufhebung: ${alt}`);
    // Die Gegenzeilen sind selbst ein Paar: beide mit derselben, neuen Kennung
    const settlementId = randomUUID();
    const gegen = await tx
      .insert(schema.documentSettlements)
      .values([
        {
          documentId: row.documentId,
          counterDocumentId: row.counterDocumentId,
          settlementId,
          date: parsed.date,
          amount: -row.amount,
          note: aufhebung(row.note),
          reversesId: row.id,
          createdBy: actor,
        },
        {
          documentId: partner.documentId,
          counterDocumentId: partner.counterDocumentId,
          settlementId,
          date: parsed.date,
          amount: -partner.amount,
          note: aufhebung(partner.note),
          reversesId: partner.id,
          createdBy: actor,
        },
      ])
      .returning({ id: schema.documentSettlements.id });
    // Die Buchungen beider Seiten (#786) fallen mit der Aufhebung: je Seite eine Gegenbuchung am Tag der Aufhebung,
    // nicht rückwirkend. Ältere Verrechnungen ohne Buchung bleiben ohne Gegenbuchung.
    const company = await openBooks(tx);
    for (const [i, verrechnung] of [row, partner].entries()) await storniereVerrechnung(tx, company, verrechnung.id, gegen[i]!.id, parsed.date);
    // Aufhebung vor der Ausführung (#693): Der zurückgelegte Anteil gehört wieder zur Freigabe zum Ausführungsdatum
    for (const id of [row.documentId, partner.documentId]) await freigabeNachziehen(tx, id, company, parsed.date);
    return { ok: true as const, date: parsed.date };
  });
}
