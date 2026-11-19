import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { useAction } from "../lib/use-action.ts";
import { copyInvoiceAsDraft } from "../server/functions/invoices.ts";

type ActionState = Pick<ReturnType<typeof useAction>, "busy" | "run">;

/**
 * Nächste ähnliche Rechnung: neuer Entwurf mit Kunde und Positionen. Abschlag und Schlussrechnung entstehen aus dem Angebot,
 * Storno und Korrektur aus der Rechnung; dort gibt es den Knopf nicht. Fehler meldet die Seite über `action`.
 */
export function InvoiceCopyButton({ invoice, action }: { invoice: { id: string; kind: string; variant: string | null }; action: ActionState }) {
  const copy = useServerFn(copyInvoiceAsDraft);
  const navigate = useNavigate();
  if (invoice.kind !== "rechnung" || invoice.variant !== null) return null;
  const onCopy = () =>
    action.run(async () => {
      const draft = await copy({ data: invoice.id });
      await navigate({ to: "/rechnungen/$id", params: { id: draft.id } });
    });
  return (
    <button type="button" className="btn" onClick={() => void onCopy()} disabled={action.busy}>
      Kopieren
    </button>
  );
}
