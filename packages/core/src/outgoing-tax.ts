import type { Section4Provision, TurnoverClassification } from "./gesamtumsatz.ts";
import type { TaxTreatment } from "./treatment.ts";

/** Festgestellte Tatsachen der Ausgangsleistung; null bedeutet ungeklärt, keine Ableitung aus dem Belegfreitext. */
export interface OutgoingTaxDetails {
  exemption: Section4Provision | null;
  ancillary: boolean | null;
  /** Tatsächlicher Leistungsort; noForeignVat bestätigt gesondert, dass keine ausländische Steuer auszuweisen ist. */
  foreignPlace: { country: string; noForeignVat: boolean } | null;
  assetDisposal: boolean;
}

/** Bekannte Vorschriften und Leistungsorte müssen zum Ganzen passen; ungeklärte Altdaten werden nicht ergänzt. */
export function outgoingTaxDetailConflict(
  treatment: TaxTreatment,
  first: OutgoingTaxDetails | null | undefined,
  second: OutgoingTaxDetails | null | undefined,
): "exemption" | "foreignPlace" | null {
  const a = first?.exemption;
  const b = second?.exemption;
  if (treatment === "steuerfrei" && a && b && (a.number !== b.number || (a.letter || "") !== (b.letter || ""))) return "exemption";
  if (
    (treatment === "reverse_charge" || treatment === "drittland" || treatment === "eu_sonstige") &&
    first?.foreignPlace &&
    second?.foreignPlace &&
    first.foreignPlace.country !== second.foreignPlace.country
  )
    return "foreignPlace";
  return null;
}

/**
 * Ordnet festgestellte Tatsachen der Zählgrundlage zu, prüft aber nicht die Voraussetzungen der Befreiung.
 * § 19 Abs. 2 UStG: https://www.gesetze-im-internet.de/ustg_1980/__19.html
 * Die Ausfuhr und innergemeinschaftliche Lieferung sind bereits § 4 Nr. 1 a/b zugeordnet; sonst kein Freitextparsing.
 */
export function outgoingTaxClassification(treatment: TaxTreatment, details: OutgoingTaxDetails | null | undefined): TurnoverClassification {
  if (details?.assetDisposal) return { kind: "asset_disposal" };
  switch (treatment) {
    case "steuerfrei":
      return { kind: "section4", provision: details?.exemption ?? null, ancillary: details?.ancillary ?? null };
    case "reverse_charge":
    case "drittland":
    case "eu_sonstige": {
      const country = details?.foreignPlace?.country;
      // Ob eine ausländische Steuer anfällt, ändert nicht den ausländischen Leistungsort (§ 1 Abs. 1 Nr. 1 UStG).
      return { kind: "foreign", confirmed: country?.length === 2 && /^[A-Z]{2}$/.test(country) && country !== "DE" };
    }
    case "ausfuhr":
      return { kind: "section4", provision: { number: "1", letter: "a" }, ancillary: null };
    case "ig_lieferung":
      return { kind: "section4", provision: { number: "1", letter: "b" }, ancillary: null };
    case "regulaer":
    case "kleinunternehmer":
      return { kind: "domestic" };
  }
}

/** Text zur ausdrücklich erfassten Vorschrift; alte freie Befreiungstexte werden hier nicht ausgewertet. */
export function section4Note(provision: Section4Provision | null | undefined): string | null {
  if (!provision) return null;
  return `Steuerfreie Leistung nach § 4 Nr. ${provision.number}${provision.letter ? ` Buchst. ${provision.letter}` : ""} UStG.`;
}
