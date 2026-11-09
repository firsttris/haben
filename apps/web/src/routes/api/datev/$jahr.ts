import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { DatevExportError, datevExport } from "../../../server/modules/auswertungen/index.ts";

/** DATEV-Buchungsstapel eines Jahres: /api/datev/2026 */
export const Route = createFileRoute("/api/datev/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "lesen");
        if (user instanceof Response) return user;
        const year = Number(params.jahr);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Ungültiges Jahr", { status: 400 });
        try {
          // Mit Personenkonten hält der Export die geschriebenen Nummern fest, im Namen des Benutzers; neue nur der Inhaber
          const { bytes, filename } = await datevExport(year, new Date(), { id: user.id, role: user.role });
          return new Response(new Uint8Array(bytes), {
            headers: {
              "Content-Type": "text/csv; charset=windows-1252",
              "Content-Disposition": `attachment; filename="${filename}"`,
              "Cache-Control": "private, no-store",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          if (error instanceof DatevExportError) return new Response(error.message, { status: 409 });
          throw error;
        }
      },
    },
  },
});
