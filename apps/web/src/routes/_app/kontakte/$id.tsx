import { formatDuration } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { ContactForm } from "../../../components/ContactForm.tsx";
import { ContactHistory } from "../../../components/ContactHistory.tsx";
import { ContactPersonsCard } from "../../../components/ContactPersonsCard.tsx";
import { MandateCard } from "../../../components/MandateCard.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { NumberingCard } from "../../../components/NumberingCard.tsx";
import { UstIdBestaetigungCard } from "../../../components/UstIdBestaetigungCard.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { ERSTES_JAHR, LETZTES_JAHR } from "../../../lib/jahre.ts";
import { useAction } from "../../../lib/use-action.ts";
import { archiveContact, getContactDetail, getContactHistory } from "../../../server/functions/contacts.ts";
import { getContactPersons } from "../../../server/functions/contact-persons.ts";
import { getCustomerNumbering } from "../../../server/functions/invoices.ts";
import { getContactServiceSummary } from "../../../server/functions/leistungen.ts";
import { getMandates } from "../../../server/functions/mandate.ts";
import { getUstIdBestaetigungen } from "../../../server/functions/ustid-bestaetigung.ts";
import chartStyles from "../../../styles/auswertungen.css?url";
import styles from "../../../styles/kontakte.css?url";

export const Route = createFileRoute("/_app/kontakte/$id")({
  validateSearch: z.object({
    /** Jahr der Listen unter „Umsatz und Rechnungen“ und „Ausgaben und Belege“; ohne das neueste mit Einträgen */
    jahr: z.optional(z.int().check(z.minimum(ERSTES_JAHR), z.maximum(LETZTES_JAHR))),
    /** Gerade angelegt: USt-IdNr. beim BZSt bestätigen, wenn fällig (#1385) */
    bestaetigen: z.optional(z.boolean()),
  }),
  loaderDeps: ({ search }) => ({ jahr: search.jahr }),
  loader: async ({ params, deps }) => {
    const [detail, mandates, personen, history, ustid, kreise, service] = await Promise.all([
      getContactDetail({ data: params.id }),
      getMandates({ data: params.id }),
      getContactPersons({ data: params.id }),
      getContactHistory({ data: { id: params.id, year: deps.jahr } }),
      getUstIdBestaetigungen({ data: params.id }),
      getCustomerNumbering({ data: { contactId: params.id } }),
      getContactServiceSummary({ data: params.id }),
    ]);
    return { ...detail, ...mandates, ...personen, history, ustid, kreise, service };
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
  const { contact, versions, mandates, persons, today, history, ustid, kreise, service } = Route.useLoaderData();
  const { bestaetigen } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });
  const archive = useServerFn(archiveContact);
  const { busy, notice, run } = useAction();
  // Kontakt, der gerade gespeichert wurde; das Formular entsteht danach mit der neuen Version neu (key) und zeigt die Meldung von hier
  const [savedId, setSavedId] = useState<string | null>(null);
  // Kontakt, für den nach dem Anlegen (Suchparameter) oder Speichern einmal beim BZSt nachgefragt wird; eine ID wie savedId,
  // denn beim Wechsel zu einem anderen Kontakt bleibt die Seite stehen
  const [pruefenFuer, setPruefenFuer] = useState<string | null>(null);
  // Den Suchparameter gleich nehmen, solange die Seite den Kontakt zeigt; später träfe die Navigation die Seite, auf der man dann ist
  useEffect(() => {
    if (!bestaetigen) return;
    setPruefenFuer(contact.id);
    void navigate({ search: (s) => ({ ...s, bestaetigen: undefined }), replace: true });
  }, [bestaetigen, contact.id, navigate]);
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
          {/* Zeiteinträge bei Kunden und bei jedem Kontakt mit Einträgen (#1557); offene führen gleich zum Stand „offen“ */}
          {(contact.isCustomer || service.entries > 0) && (
            <Link to="/leistungen" search={{ kunde: contact.id, stand: service.openMinutes > 0 ? "offen" : undefined }} className="btn">
              Zeiteinträge{service.openMinutes > 0 && ` · ${formatDuration(service.openMinutes)} offen`}
            </Link>
          )}
          <Link to="/rechnungen/neu" search={contact.isCustomer && !contact.archivedAt ? { kunde: contact.id } : {}} className="btn">
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
        <ContactForm
          key={contact.version}
          contact={contact}
          saved={savedId === contact.id}
          onUpdated={() => {
            setSavedId(contact.id);
            setPruefenFuer(contact.id);
          }}
        />
        <div className="stack">
          {/* Abgeschaltet wie vor #1385: ohne Karte, außer es gibt schon Antworten */}
          {(ustid.bestaetigungen.length > 0 || ustid.zustand.art === "bereit" || ustid.zustand.art === "ohne-eigene") && (
            <UstIdBestaetigungCard
              key={contact.id}
              contactId={contact.id}
              ustId={contact.ustId}
              bestaetigungen={ustid.bestaetigungen}
              zustand={ustid.zustand}
              nachSpeichern={pruefenFuer === contact.id}
              onNachSpeichernErledigt={() => setPruefenFuer((id) => (id === contact.id ? null : id))}
            />
          )}
          <ContactPersonsCard contactId={contact.id} persons={persons} />
          <MandateCard
            contactId={contact.id}
            contactName={contact.name}
            contactIban={contact.iban}
            isCustomer={contact.isCustomer}
            mandates={mandates}
            today={today}
          />
          {/* Zähler je Kunde (#1426): die Karte einer Art steht nur, wenn deren Kreis läuft und der Kontakt eine Kundennummer trägt */}
          {contact.kundennummer && kreise.invoice && <NumberingCard numbering={kreise.invoice} contactId={contact.id} />}
          {contact.kundennummer && kreise.quote && <NumberingCard numbering={kreise.quote} contactId={contact.id} />}
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
