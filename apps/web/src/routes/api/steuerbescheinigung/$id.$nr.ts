import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { AusschuettungError, loadSteuerbescheinigungPdf } from "../../../server/modules/ausschuettung/index.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { today } from "../../../server/today.ts";

/** Steuerbescheinigung nach § 45a Abs. 2 EStG als Download: /api/steuerbescheinigung/<Ausschüttung>/<Nr. des Gesellschafters> */
export const Route = createFileRoute("/api/steuerbescheinigung/$id/$nr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        const nr = z.coerce.number().int().min(0).max(19).safeParse(params.nr);
        if (!id.success || !nr.success) return new Response("Nicht gefunden", { status: 404 });
        try {
          const row = await loadSteuerbescheinigungPdf(id.data, nr.data, today());
          if (!row) return new Response("Nicht gefunden", { status: 404 });
          return fileResponse(row.pdf, { mimeType: "application/pdf", filename: row.filename }, true);
        } catch (error) {
          // Fehlende Angaben oder Storno: Text statt eines leeren Formulars
          if (error instanceof AusschuettungError)
            return new Response(error.message, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
          throw error;
        }
      },
    },
  },
});
