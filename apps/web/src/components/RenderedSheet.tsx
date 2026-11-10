import { useRenderedSheet } from "../lib/use-rendered-sheet.ts";
import type { DocumentPreviewInput } from "../server/modules/rechnungen/index.ts";

/** Das echte Blatt aus Typst: dieselbe Vorlage wie das PDF, Seite für Seite aus einem gemeinsamen Bild geschnitten */
export function RenderedSheet({ input, revision }: { input: DocumentPreviewInput; revision: string | null }) {
  const label = input.kind === "angebot" ? "Vorschau des Angebots" : "Vorschau der Rechnung";
  const { sheet, failure, outdated, refresh } = useRenderedSheet(input, revision);
  return (
    <div className="sheet" aria-label={label}>
      {failure && (
        <div className="banner banner-error" role="alert">
          {failure}
        </div>
      )}
      {outdated && (
        <div className="sheet-outdated" role="status">
          <span className="small">Das Blatt zeigt noch den vorigen Stand.</span>
          <button type="button" className="btn btn-sm" onClick={() => void refresh()}>
            Aktualisieren
          </button>
        </div>
      )}
      {sheet ? (
        Array.from({ length: sheet.pages }, (_, page) => (
          <div key={page} className="sheet-page" style={{ aspectRatio: `${sheet.width} / ${sheet.height}` }}>
            <img
              draggable={false}
              src={sheet.url}
              alt={`Seite ${page + 1} von ${sheet.pages}`}
              style={{ height: `${sheet.pages * 100}%`, top: `${page * -100}%` }}
            />
          </div>
        ))
      ) : (
        <div className="sheet-page sheet-page-empty" role="status">
          {!failure && "Vorschau wird gesetzt …"}
        </div>
      )}
      {sheet && (
        <div className="visually-hidden">
          {sheet.text.map(({ part, lines }) => (
            <div key={part} data-teil={part}>
              {lines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
