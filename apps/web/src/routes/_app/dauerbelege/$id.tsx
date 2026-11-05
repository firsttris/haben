import { formatEuro, type RecurringInterval } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { DauerbelegForm, type DauerbelegValues } from "../../../components/DauerbelegForm.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { dauerbelegFormData } from "../../../lib/dauerbeleg.ts";
import { formatDate, formatDateTime, formatSize } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { changeDauerbelegStatus, getDauerbelegDetail, removeDauerbeleg, saveDauerbeleg } from "../../../server/functions/dauerbelege.ts";

export const Route = createFileRoute("/_app/dauerbelege/$id")({
  loader: ({ params }) => getDauerbelegDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.vorlage.name ?? "Dauerbeleg"} · Haben` }] }),
  component: DauerbelegDetailPage,
});

const STATUS_TEXT = {
  aktiv: "Aktiv: Haben legt zu jedem Termin einen Beleg zum Prüfen an.",
  pausiert: "Pausiert: Bis zum Fortsetzen entstehen keine Belege. Termine, die in die Pause fallen, legt Haben auch danach nicht an.",
  beendet: "Beendet: Es entstehen keine Belege mehr. Die angelegten bleiben, wie sie sind.",
} as const;

function DauerbelegDetailPage() {
  const { vorlage, belege, termine, suppliers, categories, kleinunternehmer } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveDauerbeleg);
  const changeStatus = useServerFn(changeDauerbelegStatus);
  const remove = useServerFn(removeDauerbeleg);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState<"loeschen" | "beenden" | null>(null);

  const status = (aktion: "pausieren" | "fortsetzen" | "beenden", done: string) =>
    run(async () => {
      await changeStatus({ data: { id: vorlage.id, aktion } });
      setConfirming(null);
      await router.invalidate();
    }, done);

  const initial: DauerbelegValues = {
    name: vorlage.name,
    supplierName: vorlage.supplierName,
    supplierUstId: vorlage.supplierUstId,
    supplierContactId: vorlage.supplierContactId,
    reference: vorlage.reference,
    category: vorlage.category,
    payment: vorlage.payment,
    privateShare: vorlage.privateShare,
    amounts: vorlage.amounts.map((a) => ({ ...a, taxRate: a.taxRate as 1900 | 700 | 0 })),
    taxShown: vorlage.taxShown,
    note: vorlage.note,
    intervalMonths: vorlage.intervalMonths as RecurringInterval,
    nextDate: vorlage.nextDate,
    endDate: vorlage.endDate,
    dueDays: vorlage.dueDays,
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/dauerbelege">Dauerbelege</Link> › Vorlage
          </div>
          <h1>{vorlage.name}</h1>
        </div>
        <div className="actions">
          {vorlage.status === "aktiv" && (
            <button type="button" className="btn" disabled={busy} onClick={() => status("pausieren", "Pausiert.")}>
              Pausieren
            </button>
          )}
          {vorlage.status === "pausiert" && (
            <button type="button" className="btn" disabled={busy} onClick={() => status("fortsetzen", "Fortgesetzt.")}>
              Fortsetzen
            </button>
          )}
          {vorlage.status !== "beendet" && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => (confirming === "beenden" ? status("beenden", "Beendet.") : setConfirming("beenden"))}
            >
              {confirming === "beenden" ? "Endgültig beenden" : "Beenden"}
            </button>
          )}
          {belege.length === 0 && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirming !== "loeschen") return setConfirming("loeschen");
                run(async () => {
                  await remove({ data: vorlage.id });
                  await navigate({ to: "/dauerbelege" });
                });
              }}
            >
              {confirming === "loeschen" ? "Endgültig löschen" : "Löschen"}
            </button>
          )}
        </div>
      </div>
      {confirming === "beenden" && (
        <div className="banner" role="status">
          Beenden ist endgültig: Es entstehen keine Belege mehr, auch nicht nach einer Änderung. Vorübergehend anhalten geht mit Pausieren.
        </div>
      )}
      {vorlage.lastError && (
        <div className="banner" role="alert">
          {vorlage.lastError}
        </div>
      )}
      <NoticeBanner notice={notice} />
      <p className="small" style={{ margin: 0 }}>
        {STATUS_TEXT[vorlage.status]}
        {termine.length > 0 && ` Nächste Termine: ${termine.map((t) => formatDate(t)).join(", ")}.`}
      </p>
      <div className="editor-grid">
        {vorlage.status === "beendet" ? (
          <section className="card stack" aria-label="Dauerbeleg">
            <p style={{ margin: 0 }}>
              {vorlage.supplierName} · {formatEuro(vorlage.amounts.reduce((s, a) => s + a.net + a.tax, 0))} je Termin
            </p>
          </section>
        ) : (
          <DauerbelegForm
            key={String(vorlage.updatedAt)}
            initial={initial}
            suppliers={suppliers}
            categories={categories}
            kleinunternehmer={kleinunternehmer}
            isNew={false}
            busy={busy}
            submitLabel="Speichern"
            onSubmit={(values, file) =>
              run(async () => {
                await save({ data: dauerbelegFormData(vorlage.id, values, file) });
                await router.invalidate();
              }, "Gespeichert. Die Änderung gilt für künftige Belege.")
            }
          />
        )}
        <div className="stack">
          <section className="card stack" aria-labelledby="vertrag-heading">
            <h2 id="vertrag-heading">Vertrag</h2>
            <p style={{ margin: 0 }}>
              <a href={`/api/dauerbeleg/${vorlage.id}`} target="_blank" rel="noreferrer">
                {vorlage.filename}
              </a>{" "}
              <span className="small muted">
                {formatSize(vorlage.size)} · SHA-256 {vorlage.sha256.slice(0, 12)}…
              </span>
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              Jeder Beleg nutzt die Datei, die bei seinem Anlegen hinterlegt war.
            </p>
          </section>
          <section className="card stack" aria-labelledby="belege-heading">
            <h2 id="belege-heading">Angelegte Belege</h2>
            {vorlage.lastRunAt && (
              <p className="small muted" style={{ margin: 0 }}>
                Zuletzt geprüft {formatDateTime(vorlage.lastRunAt)}
              </p>
            )}
            {belege.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Noch keine. {vorlage.status === "aktiv" ? `Der erste entsteht am ${formatDate(vorlage.nextDate)}.` : ""}
              </p>
            ) : (
              <div className="table">
                {belege.map((beleg) => (
                  <Link key={beleg.id} to="/belege/$id" params={{ id: beleg.id }} className="table-row recurring-history-cols">
                    <div className="small">{beleg.documentDate ? formatDate(beleg.documentDate) : "–"}</div>
                    <div className="small">{beleg.cancelledOn ? "Storniert" : beleg.status === "gebucht" ? "Gebucht" : "Zu prüfen"}</div>
                    <div className="num">{formatEuro(beleg.gross)}</div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
