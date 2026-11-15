import { formatDecimal, ITEM_NUMBER_MAX, LINE_DETAIL_MAX, parseEuro, UNITS, type UnitLabel } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import type { Notice } from "../lib/use-action.ts";
import { saveArticle, type getArticles } from "../server/functions/articles.ts";
import type { ArticleOption } from "./ArticleCombobox.tsx";
import { FormattedTextarea } from "./FormattedTextarea.tsx";
import { Field } from "./Field.tsx";

type Article = Awaited<ReturnType<typeof getArticles>>[number];

/** Vorbelegung eines neuen Artikels, wenn er aus einer Position entsteht */
export type ArticlePrefill = Partial<Pick<Article, "description" | "detail" | "number" | "unit" | "unitPrice" | "taxRate" | "priceIncludesTax">>;

const RATES = [
  [1900, "19 %"],
  [700, "7 %"],
  [0, "0 %"],
] as const;

export function ArticleForm({
  article,
  prefill,
  inDialog = false,
  onDone,
}: {
  article: Article | null;
  prefill?: ArticlePrefill;
  /** Im Dialog steht der Titel im Dialogkopf und die Knöpfe stehen im Fuß */
  inDialog?: boolean;
  onDone: (notice: Notice, saved?: ArticleOption) => void;
}) {
  // Das Formular steht auch im Dialog über dem Rechnungseditor, feste IDs wären dort doppelt
  const router = useRouter();
  const save = useServerFn(saveArticle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = article ?? prefill;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const price = parseEuro(text("unitPrice"));
    if (price === null) {
      setError("Der Preis ist kein gültiger Betrag.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const values = {
        number: text("number"),
        description: text("description"),
        detail: text("detail"),
        unit: text("unit") as UnitLabel,
        unitPrice: price,
        taxRate: Number(text("taxRate")) as 1900 | 700 | 0,
        priceIncludesTax: text("priceMode") === "brutto",
        note: text("note"),
      };
      const { id } = await save({ data: { id: article?.id ?? null, article: values } });
      await router.invalidate();
      onDone({ tone: "ok", text: article ? "Artikel gespeichert." : "Artikel angelegt." }, { ...values, id });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <>
      <div className="form-row cols-2">
        <Field label="Bezeichnung" hint="So steht die Position auf Rechnung und Angebot, in einer Zeile." style={{ gridColumn: "1 / -1" }}>
          {(control) => <input {...control} name="description" defaultValue={initial?.description ?? ""} maxLength={500} required autoFocus />}
        </Field>
        <Field label="Text zur Position (optional)" hint="Mehrzeilig darunter, etwa Leistungsumfang oder Konditionen." style={{ gridColumn: "1 / -1" }}>
          {(control) => <FormattedTextarea {...control} name="detail" rows={3} defaultValue={initial?.detail ?? ""} maxLength={LINE_DETAIL_MAX} />}
        </Field>
        <Field label="Artikelnummer (optional)">
          {(control) => <input {...control} name="number" defaultValue={initial?.number ?? ""} maxLength={ITEM_NUMBER_MAX} />}
        </Field>
        <Field label="Einheit">
          {(control) => (
            <select {...control} name="unit" defaultValue={initial?.unit ?? "Std."}>
              {Object.keys(UNITS).map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Preis (€)">
          {(control) => (
            <input
              {...control}
              name="unitPrice"
              inputMode="decimal"
              defaultValue={initial?.unitPrice === undefined ? "" : formatDecimal(initial.unitPrice)}
              placeholder="0,00"
              required
            />
          )}
        </Field>
        <Field label="Umsatzsteuer">
          {(control) => (
            <select {...control} name="taxRate" defaultValue={String(initial?.taxRate ?? 1900)}>
              {RATES.map(([rate, label]) => (
                <option key={rate} value={rate}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Preis ist" hint="Passt das nicht zur Rechnung, rechnet Haben den Preis beim Einfügen um." style={{ gridColumn: "1 / -1" }}>
          {(control) => (
            <select {...control} name="priceMode" defaultValue={initial?.priceIncludesTax ? "brutto" : "netto"}>
              <option value="netto">netto, zuzüglich Umsatzsteuer</option>
              <option value="brutto">brutto, inklusive Umsatzsteuer</option>
            </select>
          )}
        </Field>
        <Field label="Interne Notiz (optional)" style={{ gridColumn: "1 / -1" }}>
          {(control) => <input {...control} name="note" defaultValue={article?.note ?? ""} maxLength={1000} />}
        </Field>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
    </>
  );
  const buttons = (
    <>
      <button type="button" className="btn" onClick={() => onDone(null)}>
        Abbrechen
      </button>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {article ? "Speichern" : "Anlegen"}
      </button>
    </>
  );
  const name = article ? "Artikel bearbeiten" : "Neuer Artikel";

  if (inDialog) {
    return (
      <form onSubmit={onSubmit} aria-label={name}>
        {fields}
        <div className="actions">{buttons}</div>
      </form>
    );
  }
  return (
    <form className="card" style={{ maxWidth: 720 }} onSubmit={onSubmit} aria-label={name}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{name}</h2>
      {fields}
      <div className="actions">{buttons}</div>
    </form>
  );
}
