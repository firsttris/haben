import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { cashBookCsv } from "../../../server/cash.ts";
import { csvResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";

/** Kassenbuch eines Jahres als CSV: /api/kasse/<jahr> */
export const Route = createFileRoute("/api/kasse/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const year = yearSchema.safeParse(Number(params.jahr));
        if (!year.success) return new Response("Nicht gefunden", { status: 404 });
        return csvResponse(await cashBookCsv(year.data), `Kassenbuch-${year.data}.csv`);
      },
    },
  },
});
