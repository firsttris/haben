import { formatEuro } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod/mini";
import { DocumentCancellation } from "../../../components/DocumentCancellation.tsx";
import { type DuplikatZiel, useBelegDuplizieren } from "../../../components/BelegDuplizieren.tsx";
import { BelegVerrechnung } from "../../../components/BelegVerrechnung.tsx";
import { DocumentStatus } from "../../../components/DocumentStatus.tsx";
import { IbanCheck } from "../../../components/IbanCheck.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { getDocumentDetail } from "../../../server/functions/documents.ts";
import { ConfirmDialog, isDialogOpen } from "../../../components/ConfirmDialog.tsx";
import { DocumentForm } from "./-beleg-formular.tsx";
import { Preview } from "./-beleg-vorschau.tsx";

export const Route = createFileRoute("/_app/belege/$id")({
  /** geprueft: nach dem Buchen war kein Beleg mehr „Zu prüfen“; dupliziert und vorhanden: nach „Beleg duplizieren“ */
  validateSearch: z.object({ geprueft: z.optional(z.boolean()), dupliziert: z.optional(z.string()), vorhanden: z.optional(z.boolean()) }),
  loader: ({ params }) => getDocumentDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.document.supplierName || "Beleg"} · Haben` }],
  }),
  component: DocumentPage,
});

function DocumentPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const { geprueft, ...duplikat } = Route.useSearch();
  const inhaber = Route.useRouteContext().user.role === "inhaber";
  const { document: doc, navigation } = data;
  const running = doc.extractionStatus === "laeuft";
  // Das Formular meldet ungespeicherte Änderungen; beim Wechsel des Belegs setzt es sich mit false neu auf
  const [dirty, setDirty] = useState(false);
  // Ungespeicherte Änderungen: erst nachfragen, der Dialog wechselt und verwirft sie
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const pendingId = pending?.from === doc.id ? pending.to : null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 2500);
    return () => clearInterval(timer);
  }, [running, router]);

  const leaveTo = (id: string, ziel?: DuplikatZiel) =>
    void (id === "liste" ? navigate({ to: "/belege" }) : navigate({ to: "/belege/$id", params: { id }, search: ziel }));

  /** Zu einem anderen Beleg oder ("liste") zurück zur Liste; bei ungespeicherten Änderungen erst nachfragen */
  function go(id: string | null) {
    if (!id) return;
    if (dirty) setPending({ from: doc.id, to: id });
    else leaveTo(id);
  }
  const duplizieren = useBelegDuplizieren(data, duplikat, dirty, leaveTo);

  // J/K bzw. Pfeiltasten springen zum nächsten bzw. vorigen Beleg, wie im Bankabgleich
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (isDialogOpen() || target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      const id =
        event.key === "j" || event.key === "ArrowRight"
          ? navigation.nextId
          : event.key === "k" || event.key === "ArrowLeft"
            ? navigation.previousId
            : event.key === "Escape"
              ? "liste"
              : null;
      if (!id) return;
      event.preventDefault();
      go(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Auf dem Handy: nach links wischen zum nächsten, nach rechts zum vorigen Beleg (nicht in Eingabefeldern, nicht beim Scrollen)
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    function onStart(event: TouchEvent) {
      const target = event.target as HTMLElement;
      const touch = event.touches[0];
      start =
        event.touches.length === 1 && touch && !isDialogOpen() && !target.closest("input, select, textarea, [contenteditable]")
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    }
    function onEnd(event: TouchEvent) {
      const touch = event.changedTouches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) / 2) return;
      go(dx < 0 ? navigation.nextId : navigation.previousId);
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  });

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/belege">Belege</Link> › {doc.filename}
          </div>
          <h1>{doc.supplierName || "Neuer Beleg"}</h1>
        </div>
        <div className="actions">
          <DocumentStatus status={doc.status} extractionStatus={doc.extractionStatus} cancelled={data.cancellation !== null} />
          {navigation.position > 0 && (
            <div className="doc-nav" role="group" aria-label="Zwischen Belegen wechseln">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => go(navigation.previousId)}
                disabled={!navigation.previousId}
                title="Vorheriger Beleg (K)"
              >
                <Icon name="chevron-left" size={16} />
                Vorheriger
              </button>
              <span className="small muted">
                {navigation.position} von {navigation.total}
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => go(navigation.nextId)} disabled={!navigation.nextId} title="Nächster Beleg (J)">
                Nächster
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          )}
          {data.assetId && (
            <Link to="/anlagen/$id" params={{ id: data.assetId }} className="btn">
              Zur Anlage
            </Link>
          )}
          <a className="btn" href={`/api/beleg/${doc.id}?download`}>
            Original herunterladen
          </a>
          {inhaber && !running && duplizieren.knopf}
        </div>
      </div>
      {duplizieren.hinweise}
      <ConfirmDialog
        open={pendingId !== null}
        title="Ohne Speichern wechseln?"
        confirmLabel="Ohne Speichern wechseln"
        danger
        onConfirm={() => pendingId && leaveTo(pendingId)}
        onClose={() => setPending(null)}
      >
        <p>Der Beleg hat ungespeicherte Änderungen. Beim Wechsel gehen sie verloren.</p>
      </ConfirmDialog>
      {data.sepaTransfers.map((t) => (
        <div key={t.endToEndId} className="banner" role="status">
          <Icon name="bank" />
          <span>
            Überweisung erzeugt am {formatDateTime(t.createdAt)}: {formatEuro(t.amount)}
            {t.skonto > 0 ? ` nach ${formatEuro(t.skonto)} Skonto` : ""}, Ausführung {formatDate(t.executionDate)}, Referenz {t.endToEndId}. Bezahlt ist der
            Beleg, sobald der <Link to="/bank">Bankabgleich</Link> die Abbuchung zuordnet.
          </span>
        </div>
      ))}
      <IbanCheck
        documentId={doc.id}
        check={data.ibanCheck}
        canDecide={inhaber && doc.lockedAt !== null}
        booked={doc.lockedAt !== null}
        hasContact={doc.supplierContactId !== null}
      />
      {geprueft && doc.status === "gebucht" && (
        <div className="banner banner-ok" role="status">
          <Icon name="check" />
          <span>
            Alle Belege geprüft: Es ist keiner mehr offen. <Link to="/belege">Zur Liste</Link>
          </span>
        </div>
      )}
      <div className="editor-grid doc-editor">
        <Preview doc={doc} />
        <div className="stack">
          {/* key: nach dem Auslesen oder Speichern mit den neuen Werten aufsetzen */}
          <DocumentForm key={`${doc.id}-${String(doc.updatedAt)}`} data={data} inhaber={inhaber} onDirtyChange={setDirty} />
          {/* Außerhalb des Formulars: Enter im Feld „Grund“ speichert nicht */}
          {inhaber && <DocumentCancellation key={`storno-${doc.id}`} data={data} />}
          <BelegVerrechnung key={`verrechnung-${doc.id}`} documentId={doc.id} supplier={doc.supplierName} readOnly={!inhaber} />
        </div>
      </div>
    </>
  );
}
