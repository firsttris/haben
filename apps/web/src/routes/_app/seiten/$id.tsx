import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { getCustomPageFn } from "../../../server/functions/eigene-seiten.ts";

/**
 * Eigene Seite (#199): zeigt eine Seite außerhalb von Haben im Rahmen, etwa eine Bestellübersicht aus n8n.
 *
 * `sandbox` erlaubt, was solche Seiten brauchen: Skripte, Formulare, ihre eigene Herkunft (für ihre Anmeldung),
 * Fenster und Downloads (etwa ein Etikett als PDF) und Dialoge (auch `print()`). Nicht erlaubt ist, das Fenster von
 * Haben wegzunavigieren (allow-top-navigation fehlt). Haben gibt der Seite nichts mit: keine Sitzung, kein Token,
 * dank `no-referrer` nicht einmal die eigene Adresse.
 */
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals";

export const Route = createFileRoute("/_app/seiten/$id")({
  loader: async ({ params }) => {
    const page = await getCustomPageFn({ data: { id: params.id } });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? "Eigene Seite"} · Haben` }] }),
  component: CustomPage,
});

function CustomPage() {
  const page = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/einstellungen" search={{ bereich: "seiten" }}>
              Eigene Seiten
            </Link>
          </div>
          <h1>{page.name}</h1>
        </div>
        <div className="actions">
          <a href={page.url} className="btn" target="_blank" rel="noreferrer">
            In neuem Tab öffnen
          </a>
        </div>
      </div>
      {/* key: beim Wechsel zwischen zwei eigenen Seiten einen neuen Rahmen, sonst bliebe der Verlauf der alten Seite darin */}
      <iframe key={page.id} className="custom-page-frame" src={page.url} title={page.name} sandbox={SANDBOX} referrerPolicy="no-referrer" />
    </>
  );
}
