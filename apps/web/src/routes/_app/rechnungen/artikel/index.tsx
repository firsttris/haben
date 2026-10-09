import { formatDecimal, formatEuro, parseEuro, UNITS, type UnitLabel } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../../../lib/format.ts";
import { NoticeBanner } from "../../../../components/NoticeBanner.tsx";
import type { Notice } from "../../../../lib/use-action.ts";
import { archiveArticle, getArticles, saveArticle } from "../../../../server/functions/articles.ts";

export const Route = createFileRoute("/_app/rechnungen/artikel/")({
  loader: () => getArticles(),
  head: () => ({ meta: [{ title: "Artikel · Haben" }] }),
  component: ArticlesPage,
});

type Article = Awaited<ReturnType<typeof getArticles>>[number];

const RATES = [
  [1900, "19 %"],
  [700, "7 %"],
  [0, "0 %"],
] as const;

function ArticleForm({ article, onDone }: { article: Article | null; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const save = useServerFn(saveArticle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const price = parseEuro(text("unitPrice"));
    if (price === null) {
      setError("Der Preis ist kein gültiger Betrag.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await save({
        data: {
          id: article?.id ?? null,
          article: {
            number: text("number"),
            description: text("description"),
            unit: text("unit") as UnitLabel,
            unitPrice: price,
            taxRate: Number(text("taxRate")) as 1900 | 700 | 0,
            note: text("note"),
          },
        },
      });
      await router.invalidate();
      if (!article) element.reset();
      onDone({ tone: "ok", text: article ? "Artikel gespeichert." : "Artikel angelegt." });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-label={article ? "Artikel bearbeiten" : "Neuer Artikel"}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{article ? "Artikel bearbeiten" : "Neuer Artikel"}</h2>
      <div className="form-grid">
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Bezeichnung
          <textarea name="description" rows={2} defaultValue={article?.description ?? ""} maxLength={500} required />
          <span className="small muted">So steht die Position auf Rechnung und Angebot.</span>
        </label>
        <label className="field">
          Artikelnummer (optional)
          <input name="number" defaultValue={article?.number ?? ""} maxLength={50} />
        </label>
        <label className="field">
          Einheit
          <select name="unit" defaultValue={article?.unit ?? "Std."}>
            {Object.keys(UNITS).map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Preis netto (€)
          <input name="unitPrice" inputMode="decimal" defaultValue={article ? formatDecimal(article.unitPrice) : ""} placeholder="0,00" required />
        </label>
        <label className="field">
          Umsatzsteuer
          <select name="taxRate" defaultValue={String(article?.taxRate ?? 1900)}>
            {RATES.map(([rate, label]) => (
              <option key={rate} value={rate}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Interne Notiz (optional)
          <input name="note" defaultValue={article?.note ?? ""} maxLength={1000} />
        </label>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {article ? "Speichern" : "Anlegen"}
        </button>
        {article && (
          <button type="button" className="btn" onClick={() => onDone(null)}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

function ArticlesPage() {
  const articles = Route.useLoaderData();
  const router = useRouter();
  const archive = useServerFn(archiveArticle);
  const [editing, setEditing] = useState<Article | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = articles.filter((a) => !a.archivedAt);
  const archived = articles.filter((a) => a.archivedAt);
  const shown = showArchived ? archived : active;

  async function toggleArchive(article: Article) {
    try {
      await archive({ data: { id: article.id, archived: !article.archivedAt } });
      await router.invalidate();
      setNotice({ tone: "ok", text: article.archivedAt ? "Artikel wieder aktiv." : "Artikel archiviert." });
    } catch (e) {
      setNotice({ tone: "danger", text: errorMessage(e) });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen">Rechnungen</Link> › Artikel
          </div>
          <h1>Artikel und Leistungen</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Wiederkehrende Positionen wie Stundensätze, Tagessätze oder Pauschalen legst du hier einmal an. Im Editor für Rechnungen und
        Angebote fügst du sie mit „Aus dem Katalog einfügen“ ein und passt Menge und Text dort an. Änderungen am Katalog wirken nur auf
        neue Positionen.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        <ArticleForm
          key={editing?.id ?? "neu"}
          article={editing}
          onDone={(n) => {
            setEditing(null);
            setNotice(n);
          }}
        />
        <NoticeBanner notice={notice} />
        <section className="card" aria-label="Artikelliste">
          <div className="chip-row" role="group" aria-label="Filter">
            <button type="button" className={`chip${showArchived ? "" : " active"}`} aria-pressed={!showArchived} onClick={() => setShowArchived(false)}>
              Aktiv ({active.length})
            </button>
            <button type="button" className={`chip${showArchived ? " active" : ""}`} aria-pressed={showArchived} onClick={() => setShowArchived(true)}>
              Archiviert ({archived.length})
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {showArchived ? "Keine archivierten Artikel." : "Noch keine Artikel."}
            </p>
          ) : (
            <div className="table">
              {shown.map((a) => (
                <div key={a.id} className="history-row" style={{ alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {a.number && <span className="mono small muted">{a.number} · </span>}
                      {a.description}
                    </div>
                    <div className="small muted">
                      {formatEuro(a.unitPrice)} je {a.unit} · {a.taxRate / 100} % USt{a.note ? ` · ${a.note}` : ""}
                    </div>
                  </div>
                  <div className="actions" style={{ flexShrink: 0 }}>
                    {!a.archivedAt && (
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(a)} aria-label={`${a.description} bearbeiten`}>
                        Bearbeiten
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => void toggleArchive(a)}>
                      {a.archivedAt ? "Wiederherstellen" : "Archivieren"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
