import { periodKey } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadKapEStProtocol } from "../../../server/modules/ausschuettung/index.ts";
import { loadAnnualProtocol } from "../../../server/modules/jahreserklaerung/index.ts";
import { loadDauerfristProtocol } from "../../../server/modules/umsatzsteuer/index.ts";
import { auth } from "../../../server/auth.ts";
import { db, schema } from "../../../server/db/index.ts";
import { fileResponse } from "../../../server/file-response.ts";

/** Übertragungsprotokoll (PDF) einer Übermittlung: Voranmeldung, Jahreserklärung oder Kapitalertragsteuer-Anmeldung */
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
          const other = (await loadAnnualProtocol(id.data)) ?? (await loadKapEStProtocol(id.data)) ?? (await loadDauerfristProtocol(id.data));
          if (!other) return new Response("Nicht gefunden", { status: 404 });
          return pdfResponse(other.pdf, other.filename);
        }

        const filename = `UStVA-${periodKey(row)}-${row.createdAt.toISOString().slice(0, 10)}.pdf`;
        return pdfResponse(row.pdf, filename);
      },
    },
  },
});

const pdfResponse = (pdf: Uint8Array, filename: string) => fileResponse(pdf, { mimeType: "application/pdf", filename }, false);
