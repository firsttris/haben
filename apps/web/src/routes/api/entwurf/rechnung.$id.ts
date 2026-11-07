import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { DraftPdfError, invoiceDraftPdf } from "../../../server/modules/rechnungen/index.ts";

/**
 * Rechnungsentwurf als PDF mit dem Vermerk „ENTWURF“: /api/entwurf/rechnung/<id>, mit ?download als Datei. Nur für den
 * Inhaber: Entwürfe sind sein Arbeitsstand, die Steuerberatung sieht sie auch in Liste und Detail nicht (Issue #342).
 */
export const Route = createFileRoute("/api/entwurf/rechnung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
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
