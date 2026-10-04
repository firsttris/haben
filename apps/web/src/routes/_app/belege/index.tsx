import { EXPENSE_CATEGORIES, formatEuro, type ExpenseCategory } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { DocumentStatus, SOURCE_LABEL } from "../../../components/DocumentStatus.tsx";
import { DocumentUpload } from "../../../components/DocumentUpload.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { getDocuments } from "../../../server/functions/documents.ts";

export const Route = createFileRoute("/_app/belege/")({
  loader: () => getDocuments(),
  head: () => ({ meta: [{ title: "Belege · Haben" }] }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { documents, aiAvailable, inbox } = Route.useLoaderData();
  const router = useRouter();
  const running = documents.some((d) => d.extractionStatus === "laeuft");
  const open = documents.filter((d) => d.status === "neu").length;

  // Solange die KI liest, die Liste regelmäßig auffrischen
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Eingangsrechnungen und Quittungen</div>
          <h1>Belege</h1>
        </div>
        {open > 0 && <span className="pill pill-info">{open} zu prüfen</span>}
      </div>
      <DocumentUpload aiAvailable={aiAvailable} />
      {inbox ? (
        <p className="small muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
          Belege per E-Mail: Anhänge an {inbox.username}
          {inbox.folder !== "INBOX" ? ` (Ordner ${inbox.folder})` : ""} landen stündlich hier
          {inbox.lastRunAt ? `, zuletzt abgerufen ${formatDateTime(inbox.lastRunAt)}` : ""}.
          {inbox.lastError && <span style={{ color: "var(--danger-ink)" }}> Letzter Abruf fehlgeschlagen: {inbox.lastError}</span>}
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Rechnungen per E-Mail? Mit einem <Link to="/einstellungen">Postfach für Belege</Link> holt Haben die Anhänge selbst ab.
        </p>
      )}
      <section className="card" aria-label="Belegliste">
        {documents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Belege.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head document-cols">
              <div>Datum</div>
              <div>Lieferant</div>
              <div>Kategorie</div>
              <div className="num">Brutto</div>
              <div>Status</div>
            </div>
            {documents.map((doc) => (
              <Link key={doc.id} to="/belege/$id" params={{ id: doc.id }} className="table-row document-cols">
                <div className="muted small">{doc.documentDate ? formatDate(doc.documentDate) : "–"}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span className="ellipsis">{doc.supplierName || doc.filename}</span>
                  <span className="small muted ellipsis">
                    {doc.invoiceNumber || doc.filename}
                    {doc.extractedBy ? ` · ${SOURCE_LABEL[doc.extractedBy]}` : ""}
                  </span>
                </div>
                <div className="small">{doc.category ? EXPENSE_CATEGORIES[doc.category as ExpenseCategory].label : "–"}</div>
                <div className="num">{doc.gross ? formatEuro(doc.gross) : "–"}</div>
                <div>
                  <DocumentStatus status={doc.status} extractionStatus={doc.extractionStatus} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
