import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { confirmationPdf, deliveryNotePdf, OrderDocumentError } from "../../../server/order-documents.ts";

/**
 * Begleitdokumente als PDF: /api/dokument/auftragsbestaetigung/<angebot>,
 * /api/dokument/lieferschein-angebot/<angebot>, /api/dokument/lieferschein-rechnung/<rechnung>
 */
export const Route = createFileRoute("/api/dokument/$art/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        try {
          const file =
            params.art === "auftragsbestaetigung"
              ? await confirmationPdf(id.data)
              : params.art === "lieferschein-angebot"
                ? await deliveryNotePdf("angebot", id.data)
                : params.art === "lieferschein-rechnung"
                  ? await deliveryNotePdf("rechnung", id.data)
                  : null;
          if (!file) return new Response("Nicht gefunden", { status: 404 });
          const download = new URL(request.url).searchParams.has("download");
          return fileResponse(file.pdf, { mimeType: "application/pdf", filename: file.filename }, download);
        } catch (error) {
          if (error instanceof OrderDocumentError) return new Response(error.message, { status: 409 });
          throw error;
        }
      },
    },
  },
});
