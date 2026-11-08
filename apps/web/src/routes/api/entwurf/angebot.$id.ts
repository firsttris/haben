import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { DraftPdfError, quoteDraftPdf } from "../../../server/modules/rechnungen/index.ts";

/**
 * Angebotsentwurf als PDF mit dem Vermerk „ENTWURF“: /api/entwurf/angebot/<id>, mit ?download als Datei. Wie das
 * Angebot selbst nur für den Inhaber (Issue #342).
 */
export const Route = createFileRoute("/api/entwurf/angebot/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        try {
          const file = await quoteDraftPdf(id.data);
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
