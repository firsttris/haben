import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { HinterlegungError, hinterlegungAngabenSchema, hinterlegungPdf } from "../../../server/modules/buchhaltung/index.ts";
import { today } from "../../../server/today.ts";

/**
 * Bilanz zur Hinterlegung beim Unternehmensregister als PDF: /api/hinterlegung/2025?festgestelltAm=…&haftungsverhaeltnisse=…
 * &organkredite=…, aus dem Formular auf der Seite Jahresabschluss. Nur lesend; die Angaben werden nicht gespeichert.
 */
export const Route = createFileRoute("/api/hinterlegung/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const year = yearSchema.safeParse(Number(params.jahr));
        if (!year.success) return new Response("Nicht gefunden", { status: 404 });
        const angaben = hinterlegungAngabenSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!angaben.success) return new Response(angaben.error.issues.map((i) => i.message).join(" "), { status: 400 });
        try {
          const { filename, pdf } = await hinterlegungPdf(year.data, angaben.data, today());
          return fileResponse(pdf, { mimeType: "application/pdf", filename }, true);
        } catch (error) {
          if (error instanceof HinterlegungError) return new Response(error.message, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
          throw error;
        }
      },
    },
  },
});
