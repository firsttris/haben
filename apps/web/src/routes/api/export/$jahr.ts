import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { exportFilename, exportYear, toReadableStream } from "../../../server/export.ts";

/** Jahresarchiv als ZIP: /api/export/<jahr>, gestreamt */
export const Route = createFileRoute("/api/export/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        if (!/^\d{4}$/.test(params.jahr)) return new Response("Nicht gefunden", { status: 404 });
        const year = Number(params.jahr);
        if (year < 2000 || year > 2100) return new Response("Nicht gefunden", { status: 404 });

        const now = new Date();
        return new Response(toReadableStream(exportYear(year, now)), {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${exportFilename(year, now)}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
