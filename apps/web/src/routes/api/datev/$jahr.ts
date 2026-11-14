import { parseDatevZeitraum } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { HINWEIS_HEADER, hinweisHeader } from "../../../lib/download.ts";
import { lesend } from "../../../server/lese-route.ts";
import { DatevExportError, datevExport } from "../../../server/modules/auswertungen/index.ts";

/** DATEV-Buchungsstapel eines Jahres oder Zeitraums: /api/datev/2026 oder /api/datev/2026?zeitraum=03 */
export const Route = createFileRoute("/api/datev/$jahr")({
  server: {
    handlers: {
      GET: lesend<"jahr">(async ({ params, request }, user) => {
        const year = Number(params.jahr);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Ungültiges Jahr", { status: 400 });
        const zeitraum = parseDatevZeitraum(new URL(request.url).searchParams.get("zeitraum"));
        if (!zeitraum) return new Response("Ungültiger Zeitraum", { status: 400 });
        try {
          // Mit Personenkonten hält der Export die geschriebenen Nummern fest, im Namen des Benutzers; neue nur der Inhaber
          const { bytes, filename, warnings } = await datevExport(year, new Date(), { id: user.id, role: user.role }, zeitraum);
          return new Response(new Uint8Array(bytes), {
            headers: {
              "Content-Type": "text/csv; charset=windows-1252",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
              // Nummern, die im Belegfeld 1 zusammenfallen (#675); die Seite zeigt sie nach dem Herunterladen
              ...(warnings.length > 0 ? { [HINWEIS_HEADER]: hinweisHeader(warnings) } : {}),
            },
          });
        } catch (error) {
          if (error instanceof DatevExportError) return new Response(error.message, { status: 409 });
          throw error;
        }
      }),
    },
  },
});
