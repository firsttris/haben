import { euerToCsv } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { csvResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { euerForYear } from "../../../server/reports.ts";

/** EÜR eines Jahres als CSV */
export const Route = createFileRoute("/api/auswertungen/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const year = yearSchema.safeParse(Number(params.jahr));
        if (!year.success) return new Response("Nicht gefunden", { status: 404 });
        return csvResponse(euerToCsv(await euerForYear(year.data)), `euer-${year.data}.csv`);
      },
    },
  },
});
