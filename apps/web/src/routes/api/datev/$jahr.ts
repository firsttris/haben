import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { DatevExportError, datevExport } from "../../../server/datev-export.ts";

/** DATEV-Buchungsstapel eines Jahres: /api/datev/2026 */
export const Route = createFileRoute("/api/datev/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const year = Number(params.jahr);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Ungültiges Jahr", { status: 400 });
        try {
          const { bytes, filename } = await datevExport(year);
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
