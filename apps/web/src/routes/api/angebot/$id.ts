import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { loadQuotePdf } from "../../../server/quotes.ts";

/** PDF eines Angebots: /api/angebot/<id>, mit ?download als Datei */
export const Route = createFileRoute("/api/angebot/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        const row = id.success ? await loadQuotePdf(id.data) : null;
        if (!row) return new Response("Nicht gefunden", { status: 404 });
        const download = new URL(request.url).searchParams.has("download");
        return fileResponse(new Uint8Array(row.pdf), { mimeType: "application/pdf", filename: row.filename }, download);
      },
    },
  },
});
