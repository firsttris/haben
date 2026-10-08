import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { db, schema } from "../../../server/db/index.ts";
import { fileResponse } from "../../../server/file-response.ts";

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

        const download = new URL(request.url).searchParams.has("download");
        if (params.datei === "pdf" && row.pdf) {
          return fileResponse(row.pdf, { mimeType: "application/pdf", filename: `Rechnung-${row.number}.pdf` }, download);
        }
        if (params.datei === "xml" && row.xml) {
          const suffix = row.format === "xrechnung-ubl" ? "ubl" : "cii";
          return fileResponse(new TextEncoder().encode(row.xml), { mimeType: "application/xml", filename: `Rechnung-${row.number}-${suffix}.xml` }, download);
        }
        return new Response("Nicht gefunden", { status: 404 });
      },
    },
  },
});
