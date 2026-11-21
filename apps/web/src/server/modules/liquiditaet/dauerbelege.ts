import { addMonthsAnchored, dauerbelegFaellig, dauerbelegSummen, roundHalfAwayFromZero, type LiquiditaetsPosten } from "@haben/core";
import { listDauerbelege } from "../belege/index.ts";
import type { Kontext } from "./kontext.ts";

/*
 * Künftige Dauerbelege: aktive Vorlagen mit Zahlung „Bank“, je Termin bis zum Ende des Horizonts der Bruttobetrag zur
 * Fälligkeit (Termin plus Zahlungsziel), erwartet. Pausierte und beendete Vorlagen und solche mit Zahlung „privat“ oder
 * „Kasse“ fehlen. Ab `nextDate`: frühere Termine hat der Lauf schon als Beleg angelegt, gebucht stehen sie unter den
 * offenen Verbindlichkeiten.
 */

/** Höchstens so viele Termine je Vorlage; zwölf Monate mit monatlichem Intervall brauchen 13 */
const HOECHSTENS_TERMINE = 60;

export async function dauerbelegPosten(k: Kontext): Promise<LiquiditaetsPosten[]> {
  const posten: LiquiditaetsPosten[] = [];
  for (const { vorlage } of await listDauerbelege()) {
    if (vorlage.status !== "aktiv" || vorlage.payment !== "bank") continue;
    const { tax, gross } = dauerbelegSummen(vorlage.amounts);
    if (gross <= 0) continue;
    let termin = vorlage.nextDate;
    for (let i = 0; i < HOECHSTENS_TERMINE && termin <= k.bis && (!vorlage.endDate || termin <= vorlage.endDate); i++) {
      // Vorsteuer nur mit ausgewiesener Steuer (§ 15 Abs. 1 Nr. 1 UStG) und nur der betriebliche Teil, nach Belegdatum
      const vorsteuer = vorlage.taxShown && !k.kleinunternehmer(termin) ? roundHalfAwayFromZero((tax * (100 - vorlage.privateShare)) / 100) : 0;
      posten.push({
        datum: dauerbelegFaellig(termin, vorlage.dueDays),
        betrag: gross,
        richtung: "aus",
        text: [vorlage.name, vorlage.supplierName].filter(Boolean).join(" · "),
        quelle: { art: "dauerbeleg", id: vorlage.id },
        sicherheit: "erwartet",
        ...(vorsteuer !== 0 ? { steuer: { betrag: -vorsteuer, datum: termin } } : {}),
      });
      termin = addMonthsAnchored(termin, vorlage.intervalMonths, vorlage.anchorDay);
    }
  }
  return posten;
}
