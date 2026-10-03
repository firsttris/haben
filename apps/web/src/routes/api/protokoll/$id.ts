import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadAnnualProtocol } from "../../../server/annual.ts";
import { auth } from "../../../server/auth.ts";
import { db, schema } from "../../../server/db/index.ts";

/** Übertragungsprotokoll (PDF) einer Übermittlung: Voranmeldung oder Jahreserklärung */
export const Route = createFileRoute("/api/protokoll/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });

        const [row] = await db
          .select({
            pdf: schema.vatReturnSubmissions.protocolPdf,
            createdAt: schema.vatReturnSubmissions.createdAt,
            year: schema.vatReturns.year,
            month: schema.vatReturns.month,
          })
          .from(schema.vatReturnSubmissions)
          .innerJoin(schema.vatReturns, eq(schema.vatReturns.id, schema.vatReturnSubmissions.vatReturnId))
          .where(eq(schema.vatReturnSubmissions.id, id.data));
        if (!row?.pdf) {
          const annual = await loadAnnualProtocol(id.data);
          if (!annual) return new Response("Nicht gefunden", { status: 404 });
          return pdfResponse(annual.pdf, annual.filename);
        }

        const filename = `UStVA-${row.year}-${String(row.month).padStart(2, "0")}-${row.createdAt.toISOString().slice(0, 10)}.pdf`;
        return pdfResponse(row.pdf, filename);
      },
    },
  },
});

function pdfResponse(pdf: Uint8Array, filename: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
