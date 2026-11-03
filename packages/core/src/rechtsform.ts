/**
 * Rechtsform des Unternehmens. Sie bestimmt, wohin Geld zwischen Unternehmen und Inhaber bzw. Gesellschafter gebucht wird
 * und welche Erklärungen es gibt: Ein Einzelunternehmen hat Privatkonten, EÜR und Einkommensteuer. Eine Kapitalgesellschaft
 * (GmbH, UG) hat kein Privat; was zwischen ihr und dem Gesellschafter fließt, steht auf dem Gesellschafter-Verrechnungskonto.
 */
export const RECHTSFORMEN = {
  einzelunternehmen: "Einzelunternehmen",
  gmbh: "GmbH",
  ug: "UG (haftungsbeschränkt)",
} as const;

export type Rechtsform = keyof typeof RECHTSFORMEN;

export const RECHTSFORM_KEYS = Object.keys(RECHTSFORMEN) as [Rechtsform, ...Rechtsform[]];

/** GmbH und UG sind Kapitalgesellschaften (§ 1 Abs. 1 Nr. 1 KStG), sie bilanzieren und haben keine Privatsphäre */
export function isKapitalgesellschaft(rechtsform: Rechtsform): boolean {
  return rechtsform !== "einzelunternehmen";
}

/** Bezeichnungen für Geld zwischen Unternehmen und Inhaber bzw. Gesellschafter, je nach Rechtsform */
export interface OwnerLabels {
  /** Bankumsatz ohne Rechnung oder Beleg */
  bank: string;
  /** Beleg, den der Inhaber bzw. Gesellschafter aus eigenem Geld bezahlt hat */
  documentPaid: string;
  /** Kassenbuch: Geld in die Kasse und aus der Kasse */
  cashIn: string;
  cashOut: string;
}

const PERSON_LABELS: OwnerLabels = {
  bank: "Privat (Entnahme oder Einlage)",
  documentPaid: "Privat bezahlt (Privateinlage)",
  cashIn: "Einlage",
  cashOut: "Entnahme",
};

const GESELLSCHAFT_LABELS: OwnerLabels = {
  bank: "Gesellschafter (Verrechnungskonto)",
  documentPaid: "Vom Gesellschafter ausgelegt (Verrechnungskonto)",
  cashIn: "Vom Gesellschafter",
  cashOut: "An den Gesellschafter",
};

export function ownerLabels(rechtsform: Rechtsform): OwnerLabels {
  return isKapitalgesellschaft(rechtsform) ? GESELLSCHAFT_LABELS : PERSON_LABELS;
}
