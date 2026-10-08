import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ContactForm } from "../../../components/ContactForm.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { archiveContact, getContactDetail } from "../../../server/functions/contacts.ts";

export const Route = createFileRoute("/_app/kontakte/$id")({
  loader: ({ params }) => getContactDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.contact.name ?? "Kontakt"} · Haben` }] }),
  component: ContactPage,
});

function ContactPage() {
  const { contact, versions } = Route.useLoaderData();
  const router = useRouter();
  const archive = useServerFn(archiveContact);
  const { busy, notice, run } = useAction();
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
        <ContactForm key={contact.version} contact={contact} />
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
    </>
  );
}
