import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { cashBookCsv } from "../../../server/cash.ts";

/** Kassenbuch eines Jahres als CSV: /api/kasse/<jahr> */
export const Route = createFileRoute("/api/kasse/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const year = Number(params.jahr);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return new Response("Nicht gefunden", { status: 404 });
        return new Response(await cashBookCsv(year), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="Kassenbuch-${year}.csv"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
