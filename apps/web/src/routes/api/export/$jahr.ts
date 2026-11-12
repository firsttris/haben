import { createFileRoute } from "@tanstack/react-router";
import { lesend } from "../../../server/lese-route.ts";
import { exportFilename, exportYear, toReadableStream } from "../../../server/modules/archiv/index.ts";

/** Jahresarchiv als ZIP: /api/export/<jahr>, gestreamt */
export const Route = createFileRoute("/api/export/$jahr")({
  server: {
    handlers: {
      GET: lesend<"jahr">(async ({ params }) => {
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
      }),
    },
  },
});
