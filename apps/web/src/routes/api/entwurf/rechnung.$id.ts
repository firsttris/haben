import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { DraftPdfError, invoiceDraftPdf } from "../../../server/modules/rechnungen/index.ts";

/**
 * Rechnungsentwurf als PDF mit dem Vermerk „ENTWURF“: /api/entwurf/rechnung/<id>, mit ?download als Datei. Lesen darf
 * ihn, wer den Entwurf in Haben sieht, also auch die Steuerberatung zur Prüfung vor dem Festschreiben (Issue #342).
 */
export const Route = createFileRoute("/api/entwurf/rechnung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "lesen");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        try {
          const file = await invoiceDraftPdf(id.data);
          if (!file) return new Response("Nicht gefunden", { status: 404 });
          return fileResponse(file.pdf, { mimeType: "application/pdf", filename: file.filename }, new URL(request.url).searchParams.has("download"));
        } catch (error) {
          if (error instanceof DraftPdfError) return new Response(error.message, { status: 409 });
          throw error;
        }
      },
    },
  },
});
