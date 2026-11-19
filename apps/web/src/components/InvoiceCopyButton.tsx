import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { useAction } from "../lib/use-action.ts";
import { copyInvoiceAsDraft } from "../server/functions/invoices.ts";

type ActionState = Pick<ReturnType<typeof useAction>, "busy" | "run">;
type CopySource = { id: string; kind: string; variant: string | null };
/** Im Editor: Angaben prüfen und Ungespeichertes erst speichern; gibt die Id zum Kopieren zurück, null bricht ab */
type Prepare = () => Promise<string | null>;

/**
 * Nächste ähnliche Rechnung: neuer Entwurf mit Kunde und Positionen, aus einer festgeschriebenen Rechnung oder einem
 * Entwurf. Abschlag und Schlussrechnung entstehen aus dem Angebot, Storno und Korrektur aus der Rechnung; dort gibt es
 * kein Kopieren (null). Fehler meldet die Seite über `action`.
 */
export function useInvoiceCopy(invoice: CopySource | null, action: ActionState, prepare?: Prepare): (() => void) | null {
  const copy = useServerFn(copyInvoiceAsDraft);
  const navigate = useNavigate();
  if (invoice?.kind !== "rechnung" || invoice.variant !== null) return null;
  return () =>
    void action.run(async () => {
      const sourceId = prepare ? await prepare() : invoice.id;
      if (!sourceId) return;
      const draft = await copy({ data: sourceId });
      await navigate({ to: "/rechnungen/$id", params: { id: draft.id } });
    });
}

export function InvoiceCopyButton({ invoice, action, prepare }: { invoice: CopySource | null; action: ActionState; prepare?: Prepare }) {
  const onCopy = useInvoiceCopy(invoice, action, prepare);
  if (!onCopy) return null;
  return (
    <button type="button" className="btn" onClick={onCopy} disabled={action.busy}>
      Kopieren
    </button>
  );
}
