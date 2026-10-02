import type { InvoiceListStatus } from "../server/invoices.ts";

const LABELS: Record<InvoiceListStatus, { text: string; tone: string }> = {
  entwurf: { text: "Entwurf", tone: "pill-info" },
  offen: { text: "Offen", tone: "" },
  teilbezahlt: { text: "Teilbezahlt", tone: "pill-info" },
  bezahlt: { text: "Bezahlt", tone: "pill-ok" },
  ueberfaellig: { text: "Überfällig", tone: "pill-warn" },
  storniert: { text: "Storniert", tone: "pill-danger" },
  storno: { text: "Storno", tone: "" },
  korrektur: { text: "Korrektur", tone: "" },
};

export function InvoiceStatus({ status }: { status: InvoiceListStatus }) {
  const { text, tone } = LABELS[status];
  return <span className={`pill ${tone}`}>{text}</span>;
}
