import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod/mini";
import { ContactForm } from "../../../components/ContactForm.tsx";
import { ContactHistory } from "../../../components/ContactHistory.tsx";
import { ContactPersonsCard } from "../../../components/ContactPersonsCard.tsx";
import { MandateCard } from "../../../components/MandateCard.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../../lib/jahre.ts";
import { useAction } from "../../../lib/use-action.ts";
import { archiveContact, getContactDetail, getContactHistory } from "../../../server/functions/contacts.ts";
import { getContactPersons } from "../../../server/functions/contact-persons.ts";
import { getMandates } from "../../../server/functions/mandate.ts";
import chartStyles from "../../../styles/auswertungen.css?url";
import styles from "../../../styles/kontakte.css?url";

export const Route = createFileRoute("/_app/kontakte/$id")({
  /** Jahr der Listen unter „Umsatz und Rechnungen“ und „Ausgaben und Belege“; ohne das neueste mit Einträgen */
  validateSearch: z.object({ jahr: z.optional(z.int().check(z.minimum(ERSTES_JAHR), z.maximum(LETZTES_JAHR))) }),
  loaderDeps: ({ search }) => ({ jahr: search.jahr }),
  loader: async ({ params, deps }) => {
    const [detail, mandates, personen, history] = await Promise.all([
      getContactDetail({ data: params.id }),
      getMandates({ data: params.id }),
      getContactPersons({ data: params.id }),
      getContactHistory({ data: { id: params.id, year: deps.jahr } }),
    ]);
    return { ...detail, ...mandates, ...personen, history };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.contact.name ?? "Kontakt"} · Haben` }],
    // Säulen je Jahr nutzen Achsen, Farben und Tooltip der Auswertungen
    links: [
      { rel: "stylesheet", href: chartStyles },
      { rel: "stylesheet", href: styles },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { contact, versions, mandates, persons, today, history } = Route.useLoaderData();
  const router = useRouter();
  const archive = useServerFn(archiveContact);
  const { busy, notice, run } = useAction();
  // Kontakt, der gerade gespeichert wurde; das Formular entsteht danach mit der neuen Version neu (key) und zeigt die Meldung von hier
  const [savedId, setSavedId] = useState<string | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/kontakte">Kontakte</Link>
          </div>
          <h1>{contact.name}</h1>
        </div>
        <div className="actions">
          <Link to="/rechnungen/neu" className="btn">
            Rechnung schreiben
          </Link>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await archive({ data: { id: contact.id, archived: !contact.archivedAt } });
                await router.invalidate();
              })
            }
          >
            {contact.archivedAt ? "Wiederherstellen" : "Archivieren"}
          </button>
        </div>
      </div>
      <NoticeBanner notice={notice} />
      <div className="grid-main">
        <ContactForm key={contact.version} contact={contact} saved={savedId === contact.id} onUpdated={() => setSavedId(contact.id)} />
        <div className="stack">
          <ContactPersonsCard contactId={contact.id} persons={persons} />
          <MandateCard
            contactId={contact.id}
            contactName={contact.name}
            contactIban={contact.iban}
            isCustomer={contact.isCustomer}
            mandates={mandates}
            today={today}
          />
          <section className="card" aria-labelledby="versions-heading">
            <h2 id="versions-heading">Versionen</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Änderungen überschreiben nichts. Festgeschriebene Rechnungen behalten die Anschrift, die beim Festschreiben galt.
            </p>
            {versions.map((v) => (
              <div key={v.version} className="history-row">
                <span>Version {v.version}</span>
                <span className="small muted">{formatDateTime(v.createdAt)}</span>
              </div>
            ))}
          </section>
        </div>
      </div>
      <ContactHistory contactId={contact.id} isCustomer={contact.isCustomer} isSupplier={contact.isSupplier} history={history} />
    </>
  );
}
