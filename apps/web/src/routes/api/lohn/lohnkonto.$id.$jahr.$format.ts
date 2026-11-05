import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { csvResponse, fileResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { lohnkontoDatei } from "../../../server/modules/lohn/index.ts";
import { today } from "../../../server/today.ts";

/** Lohnkonto eines Mitarbeiters für ein Jahr (§ 41 EStG, § 4 LStDV): /api/lohn/lohnkonto/<id>/<Jahr>/pdf oder /csv */
export const Route = createFileRoute("/api/lohn/lohnkonto/$id/$jahr/$format")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        const jahr = z.coerce.number().pipe(yearSchema).safeParse(params.jahr);
        const format = z.enum(["pdf", "csv"]).safeParse(params.format);
        if (!id.success || !jahr.success || !format.success) return new Response("Nicht gefunden", { status: 404 });
        const datei = await lohnkontoDatei(id.data, jahr.data, format.data, today());
        if (!datei) return new Response("Nicht gefunden", { status: 404 });
        if (datei.format === "csv") return csvResponse(datei.csv, datei.filename);
        return fileResponse(datei.pdf, { mimeType: "application/pdf", filename: datei.filename }, true);
      },
    },
  },
});
