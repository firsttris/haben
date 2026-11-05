import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { lstbAusdruck } from "../../../server/modules/lohn/index.ts";
import { today } from "../../../server/today.ts";

/** Ausdruck der Lohnsteuerbescheinigung eines Mitarbeiters (§ 41b Abs. 1 Satz 3 EStG): /api/lohn/bescheinigung/<id>/<Jahr> */
export const Route = createFileRoute("/api/lohn/bescheinigung/$id/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        const jahr = z.coerce.number().pipe(yearSchema).safeParse(params.jahr);
        if (!id.success || !jahr.success) return new Response("Nicht gefunden", { status: 404 });
        const datei = await lstbAusdruck(id.data, jahr.data, today());
        if (!datei) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(datei.pdf, { mimeType: "application/pdf", filename: datei.filename }, true);
      },
    },
  },
});
