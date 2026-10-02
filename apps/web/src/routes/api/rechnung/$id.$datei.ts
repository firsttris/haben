import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { db, schema } from "../../../server/db/index.ts";

/** PDF bzw. XML einer festgeschriebenen Rechnung: /api/rechnung/<id>/pdf oder /xml */
export const Route = createFileRoute("/api/rechnung/$id/$datei")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success || (params.datei !== "pdf" && params.datei !== "xml")) {
          return new Response("Nicht gefunden", { status: 404 });
        }
        const [row] = await db
          .select({ number: schema.invoices.number, pdf: schema.invoices.pdf, xml: schema.invoices.xml, format: schema.invoices.format })
          .from(schema.invoices)
          .where(eq(schema.invoices.id, id.data));
        if (!row?.number) return new Response("Nicht gefunden", { status: 404 });

        const download = new URL(request.url).searchParams.has("download") ? "attachment" : "inline";
        const headers = { "Cache-Control": "private, no-store" };
        if (params.datei === "pdf" && row.pdf) {
          return new Response(new Uint8Array(row.pdf), {
            headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `${download}; filename="Rechnung-${row.number}.pdf"` },
          });
        }
        if (params.datei === "xml" && row.xml) {
          const suffix = row.format === "xrechnung-ubl" ? "ubl" : "cii";
          return new Response(row.xml, {
            headers: { ...headers, "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `${download}; filename="Rechnung-${row.number}-${suffix}.xml"` },
          });
        }
        return new Response("Nicht gefunden", { status: 404 });
      },
    },
  },
});
