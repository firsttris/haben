import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { isKapitalgesellschaft } from "@haben/core";
import { beschaeftigungsartenFor, MitarbeiterForm } from "../../../../components/MitarbeiterForm.tsx";
import { NoticeBanner } from "../../../../components/NoticeBanner.tsx";
import { useAction } from "../../../../lib/use-action.ts";
import { getMitarbeiter, saveMitarbeiterFn } from "../../../../server/functions/lohn.ts";

export const Route = createFileRoute("/_app/lohn/mitarbeiter/$id")({
  loader: async ({ params }) => {
    const mitarbeiter = await getMitarbeiter({ data: params.id });
    if (!mitarbeiter) throw notFound();
    return mitarbeiter;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData ? `${loaderData.vorname} ${loaderData.nachname}` : "Mitarbeiter"} · Haben` }] }),
  component: MitarbeiterPage,
});

function MitarbeiterPage() {
  const m = Route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(saveMitarbeiterFn);
  const { busy, notice, setNotice, run } = useAction();
  const gesellschaft = isKapitalgesellschaft(Route.useRouteContext().rechtsform);
  const jahr = new Date().getFullYear();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/lohn">Lohn</Link> › Personalnummer {m.personalnummer}
          </div>
          <h1>
            {m.vorname} {m.nachname}
          </h1>
        </div>
        <div className="actions">
          <a className="btn" href={`/api/lohn/lohnkonto/${m.id}/${jahr}/pdf`}>
            Lohnkonto {jahr} (PDF)
          </a>
          <a className="btn" href={`/api/lohn/lohnkonto/${m.id}/${jahr}/csv`}>
            Lohnkonto {jahr} (CSV)
          </a>
        </div>
      </div>
      <div className="contact-form stack">
        <p className="muted small" style={{ margin: 0 }}>
          Änderungen gelten für neue Abrechnungen. Festgeschriebene Abrechnungen behalten den Stand, mit dem sie gerechnet sind; Entwürfe rechnest du nach einer
          Änderung neu.
        </p>
        <MitarbeiterForm
          key={m.id}
          initial={m}
          arten={beschaeftigungsartenFor(gesellschaft, m.art)}
          submitLabel="Speichern"
          busy={busy}
          onError={(text) => setNotice({ tone: "danger", text })}
          onSubmit={(werte) =>
            void run(async () => {
              await save({ data: { id: m.id, data: werte } });
              await router.invalidate();
            }, "Stammdaten gespeichert.")
          }
        />
        <NoticeBanner notice={notice} />
      </div>
    </>
  );
}
