import { discountedLineAmount, formatEuro, ITEM_NUMBER_MAX, LINE_DETAIL_MAX, parseEuro, parseQuantity } from "@haben/core";
import { emptyLine, type LineState, sameText } from "../lib/editor-lines.ts";
import { unitOptions } from "../lib/units.ts";
import { ArticleCombobox, CatalogCombobox } from "./ArticleCombobox.tsx";
import { Field } from "./Field.tsx";
import { FormattedTextarea } from "./FormattedTextarea.tsx";
import { Icon } from "./Icon.tsx";
import { LineAmount, LineCell } from "./LineCell.tsx";
import { LineKind } from "./LineKind.tsx";
import { PropertyRetentionField } from "./PropertyRetentionField.tsx";
import { TextBlockField } from "./TextBlockField.tsx";
import type { InvoiceEditorModel } from "./use-invoice-editor.ts";

// Karte „Positionen“: Einleitung, je Zeile eine Position, Gesamtrabatt und Hinweis

export function InvoiceEditorLines({ editor }: { editor: InvoiceEditorModel }) {
  const {
    amountLabel,
    articles,
    contactId,
    discountIssue,
    discountText,
    editable,
    grossPrices,
    insertArticle,
    intro,
    kindIssue,
    lines,
    note,
    propertyRetention,
    quote,
    setDirty,
    setDiscountText,
    setIntro,
    setLines,
    setNote,
    setPropertyRetention,
    special,
    textBlocks,
    touch,
  } = editor;
  return (
    <section className="card" aria-labelledby="lines-heading">
      <h2 id="lines-heading">Positionen</h2>
      <TextBlockField
        label="Einleitung über den Positionen (optional)"
        kind="kopf"
        value={intro}
        onChange={touch(setIntro)}
        blocks={textBlocks}
        contactId={contactId || null}
      />
      <div className="line-row with-discount head" aria-hidden="true">
        <div className="num">Menge</div>
        <div>Einheit</div>
        <div className="num">Einzelpreis</div>
        <div className="num">Rabatt</div>
        <div>USt</div>
        <div className="num">{amountLabel}</div>
        <div />
      </div>
      {lines.map((line, index) => (
        <EditorLineRow key={line.key} editor={editor} line={line} index={index} />
      ))}
      {kindIssue && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {kindIssue}.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn-dashed"
          onClick={() => {
            const last = lines[lines.length - 1];
            setLines((prev) => [...prev, emptyLine(last?.unit ?? "Std.", special ? 0 : (last?.taxRate ?? 1900))]);
            setDirty(true);
          }}
        >
          <Icon name="plus" size={16} /> Position hinzufügen
        </button>
        {articles.length > 0 && <CatalogCombobox articles={articles} onPick={insertArticle} />}
      </div>
      <Field
        label="Gesamtrabatt (optional)"
        error={discountIssue}
        hint={
          discountIssue
            ? undefined
            : `Auf die Summe der Positionen nach ihren Rabatten, je Steuersatz anteilig; ein Betrag gilt ${grossPrices ? "brutto" : "netto"}. Skonto bleibt davon getrennt.`
        }
      >
        {(control) => <input {...control} value={discountText} placeholder="z. B. 5 % oder 100,00" onChange={(e) => touch(setDiscountText)(e.target.value)} />}
      </Field>
      <TextBlockField
        label={quote ? "Hinweis auf dem Angebot (optional)" : "Hinweis auf der Rechnung (optional)"}
        kind="fuss"
        value={note}
        onChange={touch(setNote)}
        blocks={textBlocks}
        contactId={contactId || null}
      />
      {!quote && <PropertyRetentionField checked={propertyRetention} onChange={touch(setPropertyRetention)} inherited={!editable} />}
    </section>
  );
}

function EditorLineRow({ editor, line, index }: { editor: InvoiceEditorModel; line: LineState; index: number }) {
  const { amountLabel, error, markTouched, parsed, showError, special, units, updateLine } = editor;
  const p = parsed[index]!;
  const posFehler = error(`pos-${line.key}`);
  const posFehlerId = posFehler ? `pos-fehler-${line.key}` : undefined;
  return (
    <div className="line-row with-discount">
      <LineTitle editor={editor} line={line} index={index} posFehlerId={posFehlerId} />
      <FormattedTextarea
        className="line-detail"
        rows={line.detail ? Math.min(6, line.detail.split("\n").length) : 1}
        placeholder="Text zur Position (optional, mehrzeilig)"
        aria-label={`Text zu Position ${index + 1} (optional)`}
        value={line.detail}
        maxLength={LINE_DETAIL_MAX}
        onChange={(e) => updateLine(line.key, { detail: e.target.value })}
      />
      <LineCell label="Menge">
        <input
          className="num"
          inputMode="decimal"
          aria-label={`Menge Position ${index + 1}`}
          value={line.quantity}
          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
          onBlur={() => markTouched(line.key)}
          aria-invalid={showError(line.key) && !((parseQuantity(line.quantity) ?? 0) > 0)}
          aria-describedby={posFehlerId}
        />
      </LineCell>
      <LineCell label="Einheit">
        {/* biome-ignore lint/plugin: Zeile einer Positionstabelle: Spaltenkopf und aria-label benennen die Zelle, ein Feldname je Zelle gäbe jeder Zeile eine Hülle `.field` */}
        <select aria-label={`Einheit Position ${index + 1}`} value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })}>
          {unitOptions(units, line.unit).map((unit) => (
            <option key={unit}>{unit}</option>
          ))}
        </select>
      </LineCell>
      <LineCell label="Einzelpreis">
        <input
          className="num"
          inputMode="decimal"
          aria-label={`Einzelpreis Position ${index + 1} in Euro`}
          value={line.unitPrice}
          placeholder="0,00"
          onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
          onBlur={() => markTouched(line.key)}
          aria-invalid={showError(line.key) && parseEuro(line.unitPrice) === null}
          aria-describedby={posFehlerId}
        />
      </LineCell>
      <LineCell label="Rabatt">
        <input
          className="num"
          value={line.discount}
          placeholder="–"
          autoComplete="off"
          aria-label={`Rabatt Position ${index + 1}, Prozent oder Betrag`}
          aria-invalid={showError(line.key) && p.discountError}
          aria-describedby={posFehlerId}
          onChange={(e) => updateLine(line.key, { discount: e.target.value })}
          onBlur={() => markTouched(line.key)}
        />
      </LineCell>
      <LineCell label="USt">
        {/* biome-ignore lint/plugin: Zeile einer Positionstabelle: Spaltenkopf und aria-label benennen die Zelle, ein Feldname je Zelle gäbe jeder Zeile eine Hülle `.field` */}
        <select
          aria-label={`Steuersatz Position ${index + 1}`}
          value={line.taxRate}
          disabled={special}
          onChange={(e) => updateLine(line.key, { taxRate: Number(e.target.value) as 1900 | 700 | 0 })}
        >
          <option value={1900}>19 %</option>
          <option value={700}>7 %</option>
          <option value={0}>0 %</option>
        </select>
      </LineCell>
      <LineAmount label={amountLabel}>{p.valid ? formatEuro(discountedLineAmount(p)) : "–"}</LineAmount>
      <LineActions editor={editor} line={line} index={index} p={p} />
      {posFehler && (
        <span id={posFehlerId} className="field-error" style={{ gridColumn: "1 / -1" }}>
          {posFehler}
        </span>
      )}
    </div>
  );
}

/** Artikelnummer, Beschreibung mit Artikelsuche und im Angebot die Art der Position */
function LineTitle({ editor, line, index, posFehlerId }: { editor: InvoiceEditorModel; line: LineState; index: number; posFehlerId: string | undefined }) {
  const { articles, markTouched, openNewArticle, pickArticle, quote, showError, updateLine } = editor;
  return (
    <div className={quote ? "line-title with-kind" : "line-title"}>
      <input
        className="line-item"
        placeholder="Art.-Nr."
        aria-label={`Artikelnummer Position ${index + 1} (optional)`}
        value={line.itemNumber}
        maxLength={ITEM_NUMBER_MAX}
        autoComplete="off"
        onChange={(e) => updateLine(line.key, { itemNumber: e.target.value })}
      />
      <ArticleCombobox
        label={`Beschreibung Position ${index + 1}`}
        placeholder={`Beschreibung Position ${index + 1}`}
        value={line.description}
        articles={articles}
        invalid={showError(line.key) && line.description.trim() === ""}
        describedBy={posFehlerId}
        onInput={(description) => updateLine(line.key, { description })}
        onPick={(article) => pickArticle(line.key, article)}
        onCreate={(description) => openNewArticle(line, description)}
        onBlur={() => markTouched(line.key)}
      />
      {quote && <LineKind index={index} kind={line.kind} onKind={(value) => updateLine(line.key, { kind: value })} />}
    </div>
  );
}

/** Als Artikel speichern und Entfernen */
function LineActions({ editor, line, index, p }: { editor: InvoiceEditorModel; line: LineState; index: number; p: InvoiceEditorModel["parsed"][number] }) {
  const { articles, busy, grossPrices, lines, setDirty, setLines, storeAsArticle } = editor;
  const inCatalog = articles.some(
    (a) =>
      sameText(a.description, p.description) &&
      sameText(a.detail, p.detail) &&
      a.number === p.itemNumber &&
      a.unitPrice === p.unitPrice &&
      a.unit === p.unit &&
      a.priceIncludesTax === grossPrices,
  );
  return (
    <div className="line-actions">
      <button
        type="button"
        className="icon-btn icon-btn-plain"
        aria-label={`Position ${index + 1} als Artikel speichern`}
        title={inCatalog ? "Steht schon im Artikelkatalog" : "Als Artikel speichern"}
        disabled={busy || !p.valid || inCatalog}
        onClick={() => storeAsArticle(p)}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Position ${index + 1} entfernen`}
        disabled={lines.length === 1}
        onClick={() => {
          setLines((prev) => prev.filter((l) => l.key !== line.key));
          setDirty(true);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
