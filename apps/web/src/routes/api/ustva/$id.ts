import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { meinElsterUpload, VatError } from "../../../server/modules/umsatzsteuer/index.ts";

/** Voranmeldung als XML für den Import in Mein ELSTER: /api/ustva/<id> */
export const Route = createFileRoute("/api/ustva/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        try {
          const { bytes, filename } = await meinElsterUpload(id.data);
          return new Response(new Uint8Array(bytes), {
            headers: {
              "Content-Type": "application/xml; charset=ISO-8859-15",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          if (error instanceof VatError) return new Response(error.message, { status: 409 });
          throw error;
        }
      },
    },
  },
});
