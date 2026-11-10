import { EU_COUNTRIES, formatEuro, formatRateMonth, type TaxTreatment } from "@haben/core";
import type { StoreSettlement } from "@haben/import";
import { eq } from "drizzle-orm";
import { createDraftForReference, newDraftDefaults, type DraftInput } from "../rechnungen/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { db, schema } from "../../db/index.ts";
import type { Store } from "../../db/schema.ts";
import { today as todayInGermany } from "../../today.ts";
import { STORE_LABELS } from "./connections.ts";

/*
 * Rechnungsentwurf je Monatsabrechnung an die Store-Gesellschaft. Im Kommissionsmodell (§ 3 Abs. 11a UStG, EuGH
 * C-101/24 Xyrality) erbringst du deine Leistung an den Store, nicht an die Käufer; Entgelt ist der Auszahlungsanspruch.
 * Sitzt die Gesellschaft im EU-Ausland (Google Commerce Ltd, Apple Distribution International Ltd, beide Irland), ist
 * die Leistung nach § 3a Abs. 2 UStG dort steuerbar und die Gesellschaft schuldet die Steuer (Reverse Charge, Kz 21 und
 * Zusammenfassende Meldung); sitzt sie außerhalb der EU, ist sie im Inland nicht steuerbar (Kz 45). Apple oder Google
 * stellen dir dafür keine Gutschrift aus. Die Rechnung läuft über den vorhandenen Weg: Entwurf prüfen, festschreiben, im
 * Konto des Stores dem Monatsumsatz zuordnen.
 *
 * Jeder Entwurf trägt die Referenz des Monatsumsatzes als externe Referenz (Quelle googleplay bzw. appstore); dieselbe
 * Abrechnung legt keinen zweiten an. Haben legt Entwürfe beim Abruf nur für neu übernommene Monate an, damit ein bewusst
 * gelöschter Entwurf nicht wiederkommt; für ältere Monate gibt es „Rechnungsentwürfe anlegen“ in den Einstellungen.
 */

/** Beschreibung auf der Rechnung, englisch wie die Rechnung (die Gesellschaften sitzen in Irland) */
function description(store: Store, settlement: StoreSettlement): { description: string; detail: string } {
  const month = formatRateMonth(settlement.period);
  const parts = settlement.parts.map((p) => `${p.label} ${(p.amount / 100).toFixed(2)} ${settlement.currency}`).join(", ");
  return store === "googleplay"
    ? {
        description: `Apps and in-app products distributed via Google Play, earnings ${month} (net of Google service fee)`,
        detail: `Earnings report ${settlement.periodFrom} to ${settlement.periodTo}; ${parts}`,
      }
    : {
        description: `Apps and in-app products distributed via the App Store, proceeds fiscal month ${month} in ${settlement.currency}`,
        detail: `Financial report ${settlement.periodFrom} to ${settlement.periodTo}, ${settlement.lines} lines`,
      };
}

export interface DraftOutcome {
  created: number;
  messages: string[];
}

/** Behandlung aus dem Sitz der Gesellschaft; null, wenn sie in Deutschland säße */
export function storeTreatment(land: string): TaxTreatment | null {
  const country = land.toUpperCase();
  if (country === "DE") return null;
  return EU_COUNTRIES.has(country) ? "reverse_charge" : "drittland";
}

/**
 * Legt für die Abrechnungen Entwürfe an, soweit noch keiner mit derselben Referenz besteht. Ohne gewählten Kontakt,
 * als Kleinunternehmer, ohne Euro-Betrag oder bei einem Betrag von höchstens null entsteht keiner (mit Hinweis).
 */
export async function createSettlementDrafts(actor: string, store: Store, settlements: StoreSettlement[], today = todayInGermany()): Promise<DraftOutcome> {
  const outcome: DraftOutcome = { created: 0, messages: [] };
  if (settlements.length === 0) return outcome;
  const label = STORE_LABELS[store];
  const [connection] = await db
    .select({ config: schema.storeConnections.config })
    .from(schema.storeConnections)
    .where(eq(schema.storeConnections.store, store));
  const contactId = connection?.config.contactId;
  if (!contactId) {
    outcome.messages.push(`Rechnungsentwürfe an ${label}: Wähle unter Einstellungen › Bank den Kontakt der Store-Gesellschaft.`);
    return outcome;
  }
  const [contact] = await db.select({ name: schema.contacts.name, land: schema.contacts.land }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  const treatment = contact ? storeTreatment(contact.land) : null;
  if (!contact || !treatment) {
    outcome.messages.push(`Rechnungsentwürfe an ${label}: Der gewählte Kontakt fehlt oder sitzt in Deutschland.`);
    return outcome;
  }
  if ((await loadCompany()).kleinunternehmer) {
    outcome.messages.push(
      `Rechnungsentwürfe an ${label}: Als Kleinunternehmer legt Haben keine an; wie du an den Store abrechnest, klärst du mit deiner Steuerberatung.`,
    );
    return outcome;
  }

  const defaults = await newDraftDefaults(today);
  for (const settlement of settlements) {
    if (settlement.euro === null) continue;
    if (settlement.net <= 0) {
      outcome.messages.push(`${settlement.reference}: Betrag ${formatEuro(settlement.euro)}, kein Rechnungsentwurf.`);
      continue;
    }
    const foreign = settlement.currency !== "EUR";
    const input: DraftInput = {
      ...defaults,
      contactId,
      serviceFrom: settlement.periodFrom,
      serviceTo: settlement.periodTo,
      // Bezahlt wird über den Store; Skonto passt nicht
      skonto: [],
      intro: "",
      note: "",
      taxTreatment: treatment,
      exemptionReason: "",
      priceMode: "netto",
      language: "en",
      currency: settlement.currency,
      // Derselbe Kurs wie beim Umsatz im Konto, damit Zuordnung und Rechnung in Euro übereinstimmen
      exchangeRate: foreign ? settlement.rate : null,
      exchangeRateDate: foreign ? settlement.periodTo : null,
      lines: [{ ...description(store, settlement), itemNumber: "", quantity: 1000, unit: "Psch.", unitPrice: settlement.net, taxRate: 0, discount: null }],
    };
    const { created } = await createDraftForReference(actor, input, { externalSource: store, externalId: settlement.reference });
    if (created) outcome.created++;
  }
  return outcome;
}
