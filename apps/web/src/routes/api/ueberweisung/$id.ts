import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { xmlDownloadResponse } from "../../../server/file-response.ts";
import { sepaTransferFile } from "../../../server/modules/bank/index.ts";

/** Erzeugte SEPA-Überweisung (pain.001) zum Hochladen ins Online-Banking: /api/ueberweisung/<id> */
export const Route = createFileRoute("/api/ueberweisung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        const file = id.success ? await sepaTransferFile(id.data) : null;
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return xmlDownloadResponse(file.xml, file.filename);
      },
    },
  },
});
