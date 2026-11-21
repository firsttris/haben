import {
  addMonthsAnchored,
  computeInvoiceTotals,
  invoiceDueDate,
  leistungsdatum,
  servicePeriodFor,
  type LiquiditaetsPosten,
  type RecurringInterval,
  type ServicePeriodMode,
} from "@haben/core";
import { listRecurring } from "../rechnungen/index.ts";
import type { Kontext } from "./kontext.ts";

/*
 * Künftige wiederkehrende Rechnungen: aktive Vorlagen, je Termin ab `nextDate` bis zum Ende des Horizonts der Bruttobetrag
 * zur Fälligkeit (Rechnungsdatum plus Zahlungsziel, `invoiceDueDate`), erwartet. Die Summen rechnet `computeInvoiceTotals`
 * wie bei der Rechnung, die der Lauf daraus anlegt. Die Umsatzsteuer entsteht bei Istversteuerung mit dem Zahlungseingang
 * (§ 13 Abs. 1 Nr. 1 Buchst. b UStG), bei Sollversteuerung mit Ablauf des Monats, in dem die Leistung ausgeführt ist
 * (Buchst. a Satz 1): am letzten Tag des Leistungszeitraums, wie der Lauf ihn setzt (`invoiceForDate`, `invoice-finalize.ts`).
 */

const HOECHSTENS_TERMINE = 60;

export async function wiederkehrendPosten(k: Kontext): Promise<LiquiditaetsPosten[]> {
  const posten: LiquiditaetsPosten[] = [];
  for (const { recurring: vorlage, contactName } of await listRecurring()) {
    if (!vorlage.active) continue;
    const { tax, gross } = computeInvoiceTotals(vorlage.lines, vorlage.priceMode);
    if (gross === 0) continue;
    let termin = vorlage.nextDate;
    for (let i = 0; i < HOECHSTENS_TERMINE && termin <= k.bis && (!vorlage.endDate || termin <= vorlage.endDate); i++) {
      const datum = invoiceDueDate(termin, vorlage.paymentTermDays, k.bundesland);
      const zeitraum = servicePeriodFor(termin, vorlage.intervalMonths as RecurringInterval, vorlage.servicePeriod as ServicePeriodMode);
      const steuerAm =
        k.versteuerung(termin) === "ist" ? datum : leistungsdatum({ belegdatum: termin, leistungVon: zeitraum?.from, leistungBis: zeitraum?.to });
      posten.push({
        datum,
        betrag: Math.abs(gross),
        richtung: gross > 0 ? "ein" : "aus",
        text: [vorlage.name, contactName].filter(Boolean).join(" · "),
        quelle: { art: "wiederkehrend", id: vorlage.id },
        sicherheit: "erwartet",
        ...(tax !== 0 && !k.kleinunternehmer(termin) ? { steuer: { betrag: tax, datum: steuerAm } } : {}),
      });
      termin = addMonthsAnchored(termin, vorlage.intervalMonths, vorlage.anchorDay);
    }
  }
  return posten;
}
