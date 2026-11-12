import { formatEuro } from "@haben/core";
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
import { Field } from "./Field.tsx";

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
  return <CancelForm doc={doc} issues={data.cancellationIssues} date={data.cancellationDate} today={data.today} allocations={data.cancellationAllocations} />;
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
      <div className="actions doc-actions">
        <NoticeBanner notice={notice} />
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

function CancelForm({
  doc,
  issues,
  date,
  today,
  allocations,
}: {
  doc: Detail["document"];
  issues: string[];
  date: string | null;
  today: string;
  allocations: Detail["cancellationAllocations"];
}) {
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
      await cancel({ data: { id: doc.id, cancellation: { reason, allocationIds: allocations.map((a) => a.id) } } });
      await router.invalidate();
    });
  };
  return (
    <>
      <ConfirmDialog
        open={confirming}
        title="Beleg stornieren?"
        confirmLabel="Stornieren"
        danger
        facts={[
          ...(doc.supplierName ? [{ label: "Lieferant", value: doc.supplierName }] : []),
          ...(doc.documentDate ? [{ label: "Belegdatum", value: formatDate(doc.documentDate) }] : []),
          { label: "Betrag", value: formatEuro(doc.gross), strong: true },
          ...allocations.map((a) => ({ label: "Bankzuordnung", value: `${formatDate(a.date)} · ${a.description} · ${formatEuro(a.amount)}` })),
        ]}
        onConfirm={cancelNow}
        onClose={() => setConfirming(false)}
      >
        {allocations.length > 0 && (
          <p>
            Die aufgeführten Bankzuordnungen werden mit Gegenbuchungen aufgehoben. Die Umsätze sind danach wieder offen; ein mit der Zahlung ausgebuchter Rest
            wie Skonto wird ebenfalls aufgehoben.
          </p>
        )}
        {allocations.some((a) => a.splitId) && (
          <p>
            Alle aufgeführten Teile der Aufteilung werden aufgehoben{allocations.some((a) => a.documentId !== doc.id) ? ", auch die zu weiteren Vorgängen" : ""}
            .
          </p>
        )}
        <p>{cancellationNotice(date, today)}</p>
        <Field label="Grund (optional)">
          {(control) => (
            <input {...control} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Brutto als Netto erfasst" />
          )}
        </Field>
      </ConfirmDialog>
      <div className="actions doc-actions">
        <NoticeBanner notice={notice} />
        <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
          Beleg stornieren
        </button>
      </div>
    </>
  );
}
