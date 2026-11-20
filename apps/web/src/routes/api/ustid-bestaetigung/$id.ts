import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { ustIdBestaetigungPdf } from "../../../server/modules/stammdaten/index.ts";
import { today } from "../../../server/today.ts";

/** Gespeicherte Antwort des BZSt zu einer USt-IdNr. als PDF (#1491), nur für den Inhaber wie die Karte am Kontakt */
export const Route = createFileRoute("/api/ustid-bestaetigung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await ustIdBestaetigungPdf(id.data, today());
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(file.pdf, { mimeType: "application/pdf", filename: file.filename }, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
