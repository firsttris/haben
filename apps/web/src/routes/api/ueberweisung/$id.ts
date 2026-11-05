import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { xmlDownloadResponse } from "../../../server/file-response.ts";
import { sepaTransferFile } from "../../../server/modules/bank/index.ts";

/** Erzeugte SEPA-Überweisung (pain.001) zum Hochladen ins Online-Banking: /api/ueberweisung/<id> */
export const Route = createFileRoute("/api/ueberweisung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        const file = id.success ? await sepaTransferFile(id.data) : null;
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return xmlDownloadResponse(file.xml, file.filename);
      },
    },
  },
});
