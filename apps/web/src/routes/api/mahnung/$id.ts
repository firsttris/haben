import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { loadDunningPdf } from "../../../server/dunning.ts";
import { fileResponse } from "../../../server/file-response.ts";

/** PDF einer Mahnung: /api/mahnung/<id>, mit ?download als Datei */
export const Route = createFileRoute("/api/mahnung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        const row = id.success ? await loadDunningPdf(id.data) : null;
        if (!row) return new Response("Nicht gefunden", { status: 404 });
        const download = new URL(request.url).searchParams.has("download");
        return fileResponse(new Uint8Array(row.pdf), { mimeType: "application/pdf", filename: row.filename }, download);
      },
    },
  },
});
