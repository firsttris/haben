import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { loadQuotePdf } from "../../../server/modules/rechnungen/index.ts";

/** PDF eines Angebots: /api/angebot/<id>, mit ?download als Datei */
export const Route = createFileRoute("/api/angebot/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        const row = id.success ? await loadQuotePdf(id.data) : null;
        if (!row) return new Response("Nicht gefunden", { status: 404 });
        const download = new URL(request.url).searchParams.has("download");
        return fileResponse(new Uint8Array(row.pdf), { mimeType: "application/pdf", filename: row.filename }, download);
      },
    },
  },
});
