import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { isKapitalgesellschaft } from "@haben/core";
import { beschaeftigungsartenFor, MitarbeiterForm, NEUER_MITARBEITER } from "../../../../components/MitarbeiterForm.tsx";
import { NoticeBanner } from "../../../../components/NoticeBanner.tsx";
import { useAction } from "../../../../lib/use-action.ts";
import { saveMitarbeiterFn } from "../../../../server/functions/lohn.ts";

export const Route = createFileRoute("/_app/lohn/mitarbeiter/neu")({
  head: () => ({ meta: [{ title: "Mitarbeiter anlegen · Haben" }] }),
  component: NeuerMitarbeiterPage,
});

function NeuerMitarbeiterPage() {
  const navigate = useNavigate();
  const save = useServerFn(saveMitarbeiterFn);
  const { busy, notice, setNotice, run } = useAction();
  const arten = beschaeftigungsartenFor(isKapitalgesellschaft(Route.useRouteContext().rechtsform));
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/lohn">Lohn</Link> › Mitarbeiter
          </div>
          <h1>Mitarbeiter anlegen</h1>
        </div>
      </div>
      <div className="contact-form stack">
        <p className="muted small" style={{ margin: 0 }}>
          Die Lohnsteuerabzugsmerkmale (ELStAM) überträgst du aus dem ELSTER-Portal; den Abruf über ELSTER gibt es noch nicht.
        </p>
        <MitarbeiterForm
          initial={{ ...NEUER_MITARBEITER, art: arten[0]! }}
          arten={arten}
          submitLabel="Mitarbeiter anlegen"
          busy={busy}
          onError={(text) => setNotice({ tone: "danger", text })}
          onSubmit={(werte) =>
            void run(async () => {
              await save({ data: { id: null, data: werte } });
              await navigate({ to: "/lohn" });
            })
          }
        />
        <NoticeBanner notice={notice} />
      </div>
    </>
  );
}
