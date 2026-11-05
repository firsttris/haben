import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { abrechnungDatei } from "../../../server/modules/lohn/index.ts";
import { today } from "../../../server/today.ts";

/** Entgeltabrechnung als PDF: /api/lohn/abrechnung/<id>; ein Entwurf trägt den Vermerk „Entwurf“, ?download lädt herunter */
export const Route = createFileRoute("/api/lohn/abrechnung/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const datei = await abrechnungDatei(id.data, today());
        if (!datei) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(datei.data, datei, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
