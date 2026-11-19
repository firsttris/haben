import { invoiceTitle } from "../../../lib/invoice.ts";
import type { getInvoiceDetail } from "../../../server/functions/invoices.ts";

export type Detail = Awaited<ReturnType<typeof getInvoiceDetail>>;

export const titleOf = (invoice: Detail["invoice"]) => invoiceTitle(invoice.kind, invoice.variant);
