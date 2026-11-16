import { alsMarkdown, type Verfahrensdoku } from "@firsttris/gobd-kern/verfahrensdoku";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ProcedureDetailsForm } from "../../components/ProcedureDetailsForm.tsx";
import { ProcedureDocument } from "../../components/ProcedureDocument.tsx";
import { Status } from "../../components/Status.tsx";
import { getProcedureDocument } from "../../server/functions/verfahrensdoku.ts";
import procedureStyles from "../../styles/verfahrensdoku.css?url";

/**
 * Verfahrensdokumentation aus der eigenen Instanz (#860), erreichbar unter Einstellungen › Export: oben das Dokument,
 * darunter die Angaben zum Betrieb. Drucken und „Als PDF sichern“ übernimmt der Browser; dabei bleibt nur das Blatt.
 */
export const Route = createFileRoute("/_app/einstellungen_/verfahrensdokumentation")({
  loader: () => getProcedureDocument(),
  head: () => ({ meta: [{ title: "Verfahrensdokumentation · Haben" }], links: [{ rel: "stylesheet", href: procedureStyles }] }),
  component: ProcedurePage,
});

function download(document: Verfahrensdoku) {
  const url = URL.createObjectURL(new Blob([alsMarkdown(document)], { type: "text/markdown;charset=utf-8" }));
  const link = Object.assign(window.document.createElement("a"), { href: url, download: `Verfahrensdokumentation-${document.stand.datum}.md` });
  link.click();
  URL.revokeObjectURL(url);
}

function ProcedurePage() {
  const { document, details } = Route.useLoaderData();
  const fehlt = document.luecken === 1 ? "1 Angabe fehlt" : `${document.luecken} Angaben fehlen`;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/einstellungen" search={{ bereich: "export" }}>
              Einstellungen › Export
            </Link>
          </div>
          <div className="title-with-status">
            <h1>Verfahrensdokumentation</h1>
            {document.vollstaendig ? (
              <Status tone="ok" detail={`Stand ${document.stand.datum}`}>
                Vollständig
              </Status>
            ) : (
              <Status tone="warn" emphasis="notice" detail={fehlt}>
                Unvollständig
              </Status>
            )}
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => download(document)}>
            Als Markdown
          </button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Drucken
          </button>
        </div>
      </div>
      <div className="stack procedure-page">
        {!document.vollstaendig && (
          <div className="banner banner-warn procedure-hint">
            <span>
              {fehlt}; im Dokument steht dort „Fehlt: …“. <a href="#angaben">Angaben zum Betrieb ergänzen</a>
            </span>
          </div>
        )}
        <p className="small muted procedure-hint" style={{ margin: 0 }}>
          Eine Vorlage, keine Rechtsberatung: Lass sie von deiner Steuerberatung gegenlesen. Erzeugt bei jedem Aufruf aus dem aktuellen Stand; Geheimnisse wie
          Passwörter, Schlüssel und das Zertifikat stehen nicht darin.
        </p>
        <ProcedureDocument document={document} />
        <ProcedureDetailsForm details={details} />
      </div>
    </>
  );
}
