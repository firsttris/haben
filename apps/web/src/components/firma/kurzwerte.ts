import { parseEuro } from "@haben/core";

/** Was in den einklappbaren Abschnitten der Firmendaten gesetzt ist, für die Überschrift (#1253) */

export type Mahngebuehren = Record<"1" | "2" | "3", string>;
const STUFEN = ["1", "2", "3"] as const;

/** „Basiszinssatz 2,27 % · Gebühren 0 / 5,00 / 10,00 €“; ohne Angaben „ohne Verzugszinsen · ohne Gebühren“ */
export function mahnwesenKurz(baseRate: string, fees: Mahngebuehren): string {
  const mitGebuehr = STUFEN.some((stufe) => (parseEuro(fees[stufe] || "0") ?? 0) > 0);
  const gebuehren = STUFEN.map((stufe) => fees[stufe].trim() || "0").join(" / ");
  return [baseRate.trim() ? `Basiszinssatz ${baseRate.trim()} %` : "ohne Verzugszinsen", mitGebuehr ? `Gebühren ${gebuehren} €` : "ohne Gebühren"].join(" · ");
}

/** „HRB 12345 HB · unvollständig“ */
export const handelsregisterKurz = (registernummer: string, unvollstaendig: boolean) =>
  [registernummer.trim(), unvollstaendig && "unvollständig"].filter(Boolean).join(" · ");

/** Ohne Gestattung rechnet Haben mit den monatlichen Kursen des BMF */
export const fremdwaehrungKurz = (tageskurs: boolean) => (tageskurs ? "Tageskurs" : "Umrechnungskurse des BMF");
