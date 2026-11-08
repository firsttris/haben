import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { formatDate } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import type { getDocumentDetail } from "../server/functions/documents.ts";
import { cancelDocumentFn, reenterDocumentFn } from "../server/functions/documents.ts";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

type Detail = Awaited<ReturnType<typeof getDocumentDetail>>;

/**
 * Storno eines gebuchten Belegs (#237): Gegenbuchung im noch offenen Zeitraum der Belegbuchung, sonst am Tag des Stornos;
 * danach „Storniert mit einer Gegenbuchung zum …“ und „Neu erfassen“ für einen neuen Entwurf mit derselben Datei. Wie
 * beim Buchen fragt der erste Klick nach und nennt dabei das Datum der Gegenbuchung.
 */
export function DocumentCancellation({ data }: { data: Detail }) {
  const { document: doc, cancellation, reentryId } = data;
  if (doc.replacesDocumentId && !doc.lockedAt) return <ReentryNotice replacesId={doc.replacesDocumentId} />;
  if (!doc.lockedAt) return null;
  if (cancellation) return <Cancelled documentId={doc.id} cancellation={cancellation} reentryId={reentryId} />;
  return <CancelForm documentId={doc.id} issues={data.cancellationIssues} date={data.cancellationDate} today={data.today} />;
}

function ReentryNotice({ replacesId }: { replacesId: string }) {
  return (
    <div className="banner banner-info" role="status">
      <Icon name="info" />
      <span>
        Neu erfasst aus einem{" "}
        <Link to="/belege/$id" params={{ id: replacesId }}>
          stornierten Beleg
        </Link>
        . Bitte prüfen, korrigieren und buchen.
      </span>
    </div>
  );
}

function Cancelled({
  documentId,
  cancellation,
  reentryId,
}: {
  documentId: string;
  cancellation: NonNullable<Detail["cancellation"]>;
  reentryId: string | null;
}) {
  const navigate = useNavigate();
  const reenter = useServerFn(reenterDocumentFn);
  const { busy, notice, run } = useAction();
  const [year, month] = cancellation.date.split("-").map(Number);
  const onReenter = () =>
    void run(async () => {
      const { id } = await reenter({ data: documentId });
      await navigate({ to: "/belege/$id", params: { id } });
    });
  return (
    <>
      <div className="banner banner-danger" role="status">
        <Icon name="alert" />
        <span>
          Storniert mit einer{" "}
          <Link to="/buchungen" search={{ jahr: year, monat: month }}>
            Gegenbuchung
          </Link>{" "}
          zum {formatDate(cancellation.date)}.{cancellation.reason ? ` Grund: ${cancellation.reason}` : ""}
        </span>
      </div>
      <NoticeBanner notice={notice} />
      <div className="actions doc-actions">
        {reentryId ? (
          <Link to="/belege/$id" params={{ id: reentryId }} className="btn btn-primary">
            Zur Neuerfassung
          </Link>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onReenter} disabled={busy}>
            Neu erfassen
          </button>
        )}
      </div>
    </>
  );
}

/** Der Hinweis vor dem Stornieren: in welchen Zeitraum die Gegenbuchung fällt und warum */
function cancellationNotice(date: string | null, today: string): string {
  if (date && date < today) {
    return `Haben bucht den Beleg zum ${formatDate(date)} zurück, im Zeitraum der Belegbuchung: Für ihn ist noch keine Voranmeldung abgegeben. Der Beleg bleibt festgeschrieben.`;
  }
  return `Haben bucht den Beleg zum ${formatDate(date ?? today)} zurück; der Beleg bleibt festgeschrieben. Eine abgegebene Voranmeldung bleibt unberührt, die Korrektur steht im laufenden Zeitraum.`;
}

function CancelForm({ documentId, issues, date, today }: { documentId: string; issues: string[]; date: string | null; today: string }) {
  const router = useRouter();
  const cancel = useServerFn(cancelDocumentFn);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  if (issues.length > 0) {
    return <p className="small muted">{issues.join(" ")}</p>;
  }
  const cancelNow = () => {
    void run(async () => {
      await cancel({ data: { id: documentId, cancellation: { reason } } });
      await router.invalidate();
    });
  };
  return (
    <>
      <ConfirmDialog open={confirming} title="Beleg stornieren?" confirmLabel="Stornieren" danger onConfirm={cancelNow} onClose={() => setConfirming(false)}>
        <p>{cancellationNotice(date, today)}</p>
        <label className="field">
          Grund (optional)
          <input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Brutto als Netto erfasst" />
        </label>
      </ConfirmDialog>
      <NoticeBanner notice={notice} />
      <div className="actions doc-actions">
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
          Beleg stornieren
        </button>
      </div>
    </>
  );
}
