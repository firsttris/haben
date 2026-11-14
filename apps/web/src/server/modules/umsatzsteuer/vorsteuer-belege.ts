import { abziehbareSteuer, gespeicherterAnteil, paidTaxShares, periodRange, splitPrivateShare, type Cents, type VatPeriod } from "@haben/core";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { schema, type Db, type Tx } from "../../db/index.ts";
import { gutschriftAnteile } from "./gutschrift.ts";
import type { InputTaxSource, ReverseChargeSource, IgErwerbSource } from "./vat-figures.ts";

/** Vorsteuer-Nebenbuch: Originalsteuer und historisch festgehaltene Abzugsanteile, unabhängig von heutigen Firmendaten. */
export async function vorsteuerAusBelegen(period: VatPeriod, q: Db | Tx) {
  const amounts = await belegBetraege(period, q);
  // Mit Privatanteil zählt nur der betriebliche Teil (beim Storno derselbe wie beim Buchen); Kleinunternehmer ziehen keine Vorsteuer ab
  const business = (amount: Cents, privateShare: number, sign: number) => sign * splitPrivateShare(amount, privateShare).business;
  // Eine Gutschrift „erstattet bereits Bezahltes“ mindert die Vorsteuer erst mit dem Ausgleich (#690, #786, gutschrift.ts);
  // ohne die Angabe gilt wie bei jedem Beleg das Belegdatum
  const inputTax = amounts
    .filter((a) => a.vorsteuerAbzug && !a.reverseCharge && !a.erstattetBezahltes)
    .map(({ privateShare, vorsteuerAbzug, vorsteuerAnteil, satzAnteil, reverseCharge: _rc, erstattetBezahltes: _e, sign, category: _category, ...a }) => ({
      ...a,
      base: business(a.base, privateShare, sign),
      tax: abziehbareSteuer(business(a.tax, privateShare, sign), gespeicherterAnteil({ vorsteuerAbzug, vorsteuerAnteil }, satzAnteil)),
    }))
    .filter((a) => a.tax !== 0);
  inputTax.push(...(await skontoVorsteuerAnteile(period, q)));
  // Erstattung oder Verrechnung einer Gutschrift: die Vorsteuer mindert sich im Monat des Vorgangs (§ 17 Abs. 1 Satz 2 und Satz 8 UStG),
  // je Zahlung, Verrechnung und Ausbuchung ein Eintrag mit deren Datum (gutschrift.ts)
  inputTax.push(...(await gutschriftAnteile(period, q)));
  // § 13b: Bemessungsgrundlage und Steuer voll, auch bei Privatanteil; Vorsteuer nur betrieblich
  const reverseCharge: ReverseChargeSource[] = amounts
    .filter((a): a is typeof a & { reverseCharge: "eu" | "drittland" } => a.reverseCharge === "eu" || a.reverseCharge === "drittland")
    .map(({ privateShare, vorsteuerAbzug, vorsteuerAnteil, satzAnteil, reverseCharge: rc, erstattetBezahltes: _e, sign, ...a }) => ({
      ...a,
      base: sign * a.base,
      tax: sign * a.tax,
      reverseCharge: rc,
      deductible: abziehbareSteuer(business(a.tax, privateShare, sign), gespeicherterAnteil({ vorsteuerAbzug, vorsteuerAnteil }, satzAnteil)),
    }));
  // Innergemeinschaftlicher Erwerb ebenso, nach Belegdatum auch bei Ist-Versteuerung: Die Steuer entsteht mit Ausstellung
  // der Rechnung, spätestens mit Ablauf des Folgemonats (§ 13 Abs. 1 Nr. 6 UStG), nicht mit der Zahlung
  const igErwerb: IgErwerbSource[] = amounts
    .filter((a) => a.reverseCharge === "ig_erwerb")
    .map(({ privateShare, vorsteuerAbzug, vorsteuerAnteil, satzAnteil, reverseCharge: _rc, erstattetBezahltes: _e, sign, ...a }) => ({
      ...a,
      base: sign * a.base,
      tax: sign * a.tax,
      deductible: abziehbareSteuer(business(a.tax, privateShare, sign), gespeicherterAnteil({ vorsteuerAbzug, vorsteuerAnteil }, satzAnteil)),
    }));
  // Einfuhrumsatzsteuer (§ 15 Abs. 1 Satz 1 Nr. 2 UStG): der Betrag des Bescheids ist die Steuer, abziehbar nach Belegdatum
  const einfuhr: InputTaxSource[] = amounts
    .filter((a) => a.category === "einfuhrumsatzsteuer" && a.vorsteuerAbzug && !a.reverseCharge)
    .map(({ privateShare: _p, vorsteuerAbzug: _v, reverseCharge: _rc, category: _c, erstattetBezahltes: _e, sign, ...a }) => ({
      ...a,
      base: 0,
      tax: sign * (a.base + a.tax),
    }));
  return { inputTax, reverseCharge, igErwerb, einfuhr };
}

/** Gebuchte Originalbeträge und Gegenbuchungen im angefragten Zeitraum. */
async function belegBetraege(period: VatPeriod, q: Db | Tx) {
  const { start, end } = periodRange(period);
  // Belege nach Belegdatum; ein Storno (#237) zählt mit umgekehrtem Vorzeichen im Monat des Stornos (§ 17 Abs. 1 UStG)
  const documentColumns = {
    documentId: schema.documents.id,
    supplier: schema.documents.supplierName,
    number: schema.documents.invoiceNumber,
    rate: schema.documentAmounts.taxRate,
    base: schema.documentAmounts.net,
    tax: schema.documentAmounts.tax,
    erstattetBezahltes: schema.documents.erstattetBezahltes,
    privateShare: schema.documents.privateShare,
    vorsteuerAbzug: schema.documents.vorsteuerAbzug,
    vorsteuerAnteil: schema.documents.vorsteuerAnteil,
    satzAnteil: schema.documentAmounts.vorsteuerAnteil,
    reverseCharge: schema.documents.reverseCharge,
    category: schema.documents.category,
  };
  const booked = await q
    .select({ ...documentColumns, date: schema.documents.documentDate })
    .from(schema.documentAmounts)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentAmounts.documentId))
    .where(
      and(
        eq(schema.documents.status, "gebucht"),
        gte(schema.documents.documentDate, start),
        lt(schema.documents.documentDate, end),
        isNull(schema.documents.lexofficeVoucherId),
      ),
    );
  const cancelled = await q
    .select({ ...documentColumns, date: schema.documentCancellations.date })
    .from(schema.documentAmounts)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentAmounts.documentId))
    .innerJoin(schema.documentCancellations, eq(schema.documentCancellations.documentId, schema.documents.id))
    .where(and(gte(schema.documentCancellations.date, start), lt(schema.documentCancellations.date, end)));
  const amounts = [
    ...booked.map((a) => ({ ...a, date: a.date!, sign: 1 })),
    ...cancelled.map((a) => ({ ...a, number: `Storno ${a.number}`.trim(), sign: -1 })),
  ];
  return amounts;
}

/** § 17 UStG: bei neuen Belegen genau die kumuliert gerundete Berichtigung aus der Buchung. */
async function skontoVorsteuerAnteile(period: VatPeriod, q: Db | Tx): Promise<InputTaxSource[]> {
  const { start, end } = periodRange(period);
  const result: InputTaxSource[] = [];
  // Erhaltenes Skonto mindert die Vorsteuer im Monat der Ausbuchung (§ 17 Abs. 1 Satz 2 UStG), anteilig je Steuersatz
  const discounts = await q
    .select({
      id: schema.writeOffs.id,
      documentId: schema.documents.id,
      date: schema.writeOffs.date,
      amount: schema.writeOffs.amount,
      supplier: schema.documents.supplierName,
      number: schema.documents.invoiceNumber,
      net: schema.documents.net,
      tax: schema.documents.tax,
      gross: schema.documents.gross,
      vorsteuerAbzug: schema.documents.vorsteuerAbzug,
      vorsteuerAnteil: schema.documents.vorsteuerAnteil,
    })
    .from(schema.writeOffs)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.writeOffs.documentId))
    .where(
      and(
        gte(schema.writeOffs.date, start),
        lt(schema.writeOffs.date, end),
        eq(schema.writeOffs.kind, "skontoErhalten"),
        // Ausgebuchtes Skonto an einer Gutschrift „erstattet bereits Bezahltes“ schreibt das Zwischenkonto ab, ohne die
        // Vorsteuer zu mindern (vorsteuer-ausgleich.ts); es zählt deshalb nicht hier (#786)
        eq(schema.documents.erstattetBezahltes, false),
        eq(schema.documents.vorsteuerAbzug, true),
      ),
    );
  if (discounts.length > 0) {
    const journal = await q
      .select({
        id: schema.journalEntries.sourceId,
        account: schema.journalLines.account,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        code: schema.journalLines.taxCode,
      })
      .from(schema.journalEntries)
      .innerJoin(schema.journalLines, eq(schema.journalLines.entryId, schema.journalEntries.id))
      .where(
        and(
          eq(schema.journalEntries.sourceType, "ausbuchung"),
          inArray(
            schema.journalEntries.sourceId,
            discounts.map((d) => d.id),
          ),
        ),
      );
    const docAmounts = await q
      .select()
      .from(schema.documentAmounts)
      .where(inArray(schema.documentAmounts.documentId, [...new Set(discounts.map((d) => d.documentId))]));
    for (const d of discounts) {
      const taxes = docAmounts
        .filter((a) => a.documentId === d.documentId)
        .map((a) => ({ rate: a.taxRate, base: a.net, tax: a.tax, vorsteuerAnteil: a.vorsteuerAnteil }))
        .sort((a, b) => b.rate - a.rate);
      for (const share of paidTaxShares({ net: d.net, tax: d.tax, gross: d.gross, taxes }, -d.amount)) {
        const recorded = journal.filter((l) => l.id === d.id);
        const tax =
          d.vorsteuerAnteil !== null && recorded.length > 0
            ? recorded
                .filter((l) => ["1576", "1571", "1406", "1401"].includes(l.account) && l.code === (share.rate === 1900 ? "VSt19" : "VSt7"))
                .reduce((sum, l) => sum + l.credit - l.debit, 0)
            : abziehbareSteuer(share.tax, gespeicherterAnteil(d, taxes.find((t) => t.rate === share.rate)?.vorsteuerAnteil));
        if (tax === 0) continue;
        result.push({ documentId: d.documentId, date: d.date, supplier: d.supplier, number: d.number, rate: share.rate, base: -share.base, tax: -tax });
      }
    }
  }
  return result;
}
