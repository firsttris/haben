import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { cashBookCsv } from "../../../server/modules/bank/index.ts";
import { csvResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";

/** Kassenbuch eines Jahres als CSV: /api/kasse/<jahr> */
export const Route = createFileRoute("/api/kasse/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const year = yearSchema.safeParse(Number(params.jahr));
        if (!year.success) return new Response("Nicht gefunden", { status: 404 });
        return csvResponse(await cashBookCsv(year.data), `Kassenbuch-${year.data}.csv`);
      },
    },
  },
});
