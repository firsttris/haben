import { euerToCsv, toCsv } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { csvResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { euerForYear, uncertainImportPayments, uncertainImportMessage } from "../../../server/modules/auswertungen/index.ts";

/** EÜR eines Jahres als CSV */
export const Route = createFileRoute("/api/auswertungen/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "lesen");
        if (user instanceof Response) return user;
        const year = yearSchema.safeParse(Number(params.jahr));
        if (!year.success) return new Response("Nicht gefunden", { status: 404 });
        const [euer, pending] = await Promise.all([euerForYear(year.data), uncertainImportPayments(year.data)]);
        const notice = pending > 0 ? `\r\n${toCsv([["Hinweis", uncertainImportMessage(pending)]])}` : "";
        return csvResponse(euerToCsv(euer) + notice, `euer-${year.data}.csv`);
      },
    },
  },
});
