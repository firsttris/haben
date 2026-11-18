import type { ExpenseCategory } from "@haben/core";

/**
 * Gruppen der Ausgabenkategorien in der Auswahl (#1253), nur zur Anzeige: Werte, Konten und Buchung bleiben je Kategorie.
 * Die Gruppen lehnen sich an die Kontengruppen des Kontenrahmens an (Personal 41xx, Raumkosten 42xx, Versicherungen und
 * Beiträge 43xx, Fahrzeugkosten 45xx bzw. 65xx, Reisekosten 467x, Wareneingang 3xxx). KategorieOptionen.test.ts hält fest,
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

/** Hinweis unter der Auswahl, solange nichts gewählt ist: wohin Alltägliches gehört (Kategorien „Hosting und IT-Dienste“, „Reisekosten: Fahrten“, „Kfz: Laden, Tanken, Wartung“) */
export const KATEGORIE_BEISPIEL = "Z. B. Hosting oder Software unter „Büro und IT“, Zugfahrten unter „Reisen“, Tanken unter „Fahrzeug“.";

/** Die `<option>`-Zeilen der Kategorieauswahl in Gruppen; was in keiner Gruppe steht, kommt unter „Weitere“ dazu, nichts fällt weg */
export function KategorieOptionen({ categories }: { categories: { value: string; label: string }[] }) {
  const gruppiert = new Set<string>(KATEGORIE_GRUPPEN.flatMap((g) => g.kategorien));
  const weitere = categories.filter((c) => !gruppiert.has(c.value));
  const optionen = (liste: { value: string; label: string }[]) =>
    liste.map((c) => (
      <option key={c.value} value={c.value}>
        {c.label}
      </option>
    ));
  return (
    <>
      {KATEGORIE_GRUPPEN.map((gruppe) => {
        const eintraege = gruppe.kategorien.flatMap((value) => categories.filter((c) => c.value === value));
        return (
          eintraege.length > 0 && (
            <optgroup key={gruppe.label} label={gruppe.label}>
              {optionen(eintraege)}
            </optgroup>
          )
        );
      })}
      {weitere.length > 0 && <optgroup label="Weitere">{optionen(weitere)}</optgroup>}
    </>
  );
}
