import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { useAction } from "../lib/use-action.ts";
import { copyFinalInvoice } from "../server/functions/invoices.ts";
import { type ActionMenuItem, MoreActionsMenu } from "./MoreActionsMenu.tsx";

type ActionState = Pick<ReturnType<typeof useAction>, "busy" | "run">;

/** Menüeintrag „Rechnung duplizieren“ für bestehende Ausgangsrechnungen (Entwurf oder festgeschrieben) */
export function useDuplicateInvoiceItem(invoice: { id?: string; kind: string; variant: string | null } | null, action: ActionState): ActionMenuItem | null {
  const copy = useServerFn(copyFinalInvoice);
  const navigate = useNavigate();
  if (!invoice?.id || invoice.kind !== "rechnung" || invoice.variant !== null) return null;
  const invoiceId = invoice.id;
  const onDuplicate = () =>
    action.run(async () => {
      const draft = await copy({ data: invoiceId });
      await navigate({ to: "/rechnungen/$id", params: { id: draft.id } });
    });
  return {
    key: "duplicate",
    label: "Rechnung duplizieren",
    icon: "invoice",
    disabled: action.busy,
    onSelect: () => void onDuplicate(),
  };
}

/**
 * Aktionsmenü für eine bestehende Ausgangsrechnung mit „Rechnung duplizieren“. Abschlag und Schlussrechnung entstehen aus
 * dem Angebot, Storno und Korrektur aus der Rechnung; dort gibt es die Aktion nicht. Fehler meldet die Seite über `action`.
 */
export function InvoiceCopyButton({ invoice, action }: { invoice: { id: string; kind: string; variant: string | null }; action: ActionState }) {
  const item = useDuplicateInvoiceItem(invoice, action);
  if (!item) return null;
  return <MoreActionsMenu items={[item]} />;
}
