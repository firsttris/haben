import type { ExpenseCategory } from "@haben/core";

/**
 * Gruppen der Ausgabenkategorien in der Auswahl (#1253), nur zur Anzeige und Suche: Werte, Konten und Buchung bleiben je Kategorie.
 * Die Gruppen lehnen sich an die Kontengruppen des Kontenrahmens an (Personal 41xx, Raumkosten 42xx, Versicherungen und
 * Beiträge 43xx, Fahrzeugkosten 45xx bzw. 65xx, Reisekosten 467x, Wareneingang 3xxx). KategorieGruppen.test.ts hält fest,
 * dass jede Kategorie in genau einer Gruppe steht.
 */
export const KATEGORIE_GRUPPEN: { label: string; kategorien: readonly ExpenseCategory[] }[] = [
  { label: "Büro und IT", kategorien: ["buero", "porto", "telefon", "internet", "software", "edv", "hardware", "betriebsbedarf"] },
  { label: "Räume und Ausstattung", kategorien: ["miete", "reparatur"] },
  { label: "Reisen", kategorien: ["fahrtkosten", "uebernachtung"] },
  { label: "Fahrzeug", kategorien: ["kfzBetrieb", "kfzReparatur", "kfzVersicherung", "kfzSteuer", "kfzLeasing", "kfzSonstige"] },
  { label: "Werbung und Bewirtung", kategorien: ["werbung", "bewirtung", "geschenke"] },
  { label: "Beratung und Weiterbildung", kategorien: ["beratung", "buchfuehrung", "fortbildung", "literatur"] },
  { label: "Versicherungen und Beiträge", kategorien: ["versicherung", "beitraege"] },
  { label: "Personal", kategorien: ["berufsgenossenschaft", "versorgungskassen"] },
  { label: "Waren und Fremdleistungen", kategorien: ["wareneinkauf", "fremdleistung"] },
  { label: "Sonstiges", kategorien: ["geldverkehr", "sonstiges"] },
  { label: "Anlagegut und Zoll", kategorien: ["anlage", "einfuhrumsatzsteuer"] },
];

/** Gruppe je Kategorie (#1253); was in keiner Gruppe steht, kommt unter „Weitere“ ans Ende, nichts fällt weg */
export const gruppeVon = (value: string): string => KATEGORIE_GRUPPEN.find((g) => (g.kategorien as readonly string[]).includes(value))?.label ?? "Weitere";

/** Platz einer Kategorie in der Auswahl: erst die Gruppen, innerhalb einer Gruppe in ihrer Reihenfolge; Unbekanntes ans Ende */
export const kategorieRang = (value: string): number => {
  const rang = KATEGORIE_GRUPPEN.flatMap((g) => g.kategorien as readonly string[]).indexOf(value);
  return rang < 0 ? Number.MAX_SAFE_INTEGER : rang;
};

/** Hinweis unter der Auswahl, solange nichts gewählt ist: wohin Alltägliches gehört (Kategorien „Hosting und IT-Dienste“, „Reisekosten: Fahrten“, „Kfz: Laden, Tanken, Wartung“) */
export const KATEGORIE_BEISPIEL = "Z. B. Hosting oder Software unter „Büro und IT“, Zugfahrten unter „Reisen“, Tanken unter „Fahrzeug“.";
