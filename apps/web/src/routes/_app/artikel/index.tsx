import { formatEuro } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { errorMessage } from "../../../lib/format.ts";
import { ArticleForm } from "../../../components/ArticleForm.tsx";
import { FormattedText } from "../../../components/FormattedText.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import type { Notice } from "../../../lib/use-action.ts";
import { archiveArticle, getArticles } from "../../../server/functions/articles.ts";
import { getUnits } from "../../../server/functions/units.ts";

export const Route = createFileRoute("/_app/artikel/")({
  loader: async () => {
    const [articles, units] = await Promise.all([getArticles(), getUnits()]);
    return { articles, units: units.filter((unit) => !unit.archivedAt).map((unit) => unit.label) };
  },
  head: () => ({ meta: [{ title: "Artikel · Haben" }] }),
  component: ArticlesPage,
});

type Article = Awaited<ReturnType<typeof getArticles>>[number];

function ArticlesPage() {
  const { articles, units } = Route.useLoaderData();
  const router = useRouter();
  const archive = useServerFn(archiveArticle);
  const [editing, setEditing] = useState<Article | null>(null);
  const [creating, setCreating] = useState(false);
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

  const formOpen = creating || editing !== null;
  const newButton = (
    <button
      type="button"
      className="btn btn-primary"
      onClick={() => {
        setEditing(null);
        setCreating(true);
        setNotice(null);
      }}
    >
      Neuer Artikel
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Verkauf</div>
          <h1>Artikel und Leistungen</h1>
        </div>
        {!formOpen && (
          <div className="actions">
            <Link to="/csv-import" search={{ art: "artikel" }} className="btn">
              CSV importieren
            </Link>
            {newButton}
          </div>
        )}
      </div>
      <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
        Stundensätze, Tagessätze oder Pauschalen legst du einmal an und suchst sie im Editor in der Beschreibung einer Position oder unter „Aus dem Katalog
        einfügen“. Änderungen wirken nur auf neue Positionen.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        {formOpen && (
          <ArticleForm
            key={editing?.id ?? "neu"}
            units={units}
            article={editing}
            onDone={(n) => {
              setEditing(null);
              setCreating(false);
              setNotice(n);
            }}
          />
        )}
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
              {showArchived
                ? "Keine archivierten Artikel."
                : "Noch keine Artikel. Lege den ersten mit „Neuer Artikel“ an oder speichere eine Position im Rechnungseditor."}
            </p>
          ) : (
            <div className="table">
              <div className="table-row head article-cols">
                <div>Bezeichnung</div>
                <div className="num">Preis</div>
                <div>USt</div>
                <div />
              </div>
              {shown.map((a) => (
                <div key={a.id} className="table-row article-cols">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{a.description}</div>
                    {a.detail && (
                      <div className="small" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                        <FormattedText text={a.detail} />
                      </div>
                    )}
                    {(a.number || a.note) && (
                      <div className="small muted">
                        {a.number && <span className="mono">{a.number}</span>}
                        {a.number && a.note ? " · " : ""}
                        {a.note}
                      </div>
                    )}
                  </div>
                  <div className="num">
                    {formatEuro(a.unitPrice)}
                    {a.priceIncludesTax ? " brutto" : ""} je {a.unit}
                  </div>
                  <div className="small muted">{a.taxRate / 100} %</div>
                  <div className="actions" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    {!a.archivedAt && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setCreating(false);
                          setEditing(a);
                        }}
                        aria-label={`${a.description} bearbeiten`}
                      >
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
