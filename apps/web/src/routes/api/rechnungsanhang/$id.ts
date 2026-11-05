import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { loadInvoiceAttachment } from "../../../server/modules/rechnungen/index.ts";

/** Zusätzlicher Anhang einer Rechnung (#272), im Entwurf wie nach dem Festschreiben */
export const Route = createFileRoute("/api/rechnungsanhang/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "lesen");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await loadInvoiceAttachment(id.data);
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(file.bytes, file, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
