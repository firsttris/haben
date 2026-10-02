import { euerToCsv } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { euerForYear } from "../../../server/reports.ts";

/** EÜR eines Jahres als CSV */
export const Route = createFileRoute("/api/auswertungen/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const year = z.coerce.number().int().min(2000).max(2100).safeParse(params.jahr);
        if (!year.success) return new Response("Nicht gefunden", { status: 404 });
        const csv = euerToCsv(await euerForYear(year.data));
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="euer-${year.data}.csv"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
