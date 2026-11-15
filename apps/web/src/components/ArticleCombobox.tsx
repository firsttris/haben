import { formatEuro } from "@haben/core";
import { useState } from "react";
import { sameEntry, searchOptions } from "../lib/combobox.ts";
import { Combobox, type ComboboxOption } from "./Combobox.tsx";

export interface ArticleOption {
  id: string;
  number: string;
  /** Bezeichnung, eine Zeile */
  description: string;
  /** Text unter der Bezeichnung, mehrzeilig */
  detail: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  /** Preis inklusive Umsatzsteuer */
  priceIncludesTax: boolean;
}

const articleFields = (a: ArticleOption) => [a.description, a.number];

function describeArticle(a: ArticleOption): ComboboxOption {
  const price = `${formatEuro(a.unitPrice)} ${a.priceIncludesTax ? "brutto" : "netto"} je ${a.unit}`;
  return { key: a.id, label: a.description, meta: a.number ? `${a.number} · ${price}` : price };
}

/** Bezeichnung einer Position: freier Text mit Vorschlägen aus dem Katalog; erst die Auswahl übernimmt Preis und Einheit */
export function ArticleCombobox({
  label,
  placeholder,
  value,
  articles,
  invalid,
  describedBy,
  onInput,
  onPick,
  onCreate,
  onBlur,
}: {
  label: string;
  placeholder: string;
  value: string;
  articles: ArticleOption[];
  invalid: boolean;
  /** Fehler der Position unter ihr (useSubmitCheck) */
  describedBy?: string | undefined;
  onInput: (text: string) => void;
  onPick: (article: ArticleOption) => void;
  onCreate: (description: string) => void;
  onBlur: () => void;
}) {
  const typed = value.trim();
  // Ein Name, den es schon gibt, wird nicht als neuer Artikel angeboten: etwa nach der Auswahl eines Artikels
  const name = articles.some((a) => sameEntry(a.description, typed)) ? "" : typed;
  return (
    <Combobox
      freeText
      label={label}
      placeholder={placeholder}
      value={value}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onInput={onInput}
      onBlur={onBlur}
      search={() => searchOptions(articles, value, articleFields)}
      describe={describeArticle}
      onPick={onPick}
      // Wer keinen Katalog führt, bekommt beim Tippen keine Liste
      create={articles.length > 0 ? { label: name ? `„${name}“ als neuen Artikel anlegen` : "Neuen Artikel anlegen", run: () => onCreate(name) } : null}
    />
  );
}

/** Artikel aus dem Katalog als neue Position einfügen */
export function CatalogCombobox({ articles, onPick }: { articles: ArticleOption[]; onPick: (article: ArticleOption) => void }) {
  const [query, setQuery] = useState("");
  return (
    <Combobox
      label="Aus dem Artikelkatalog einfügen"
      placeholder="Aus dem Katalog einfügen …"
      className="catalog-combobox"
      value={query}
      onInput={setQuery}
      onBlur={() => setQuery("")}
      search={() => searchOptions(articles, query, articleFields)}
      describe={describeArticle}
      onPick={(article) => {
        setQuery("");
        onPick(article);
      }}
    />
  );
}
