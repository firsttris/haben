import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { postfachDocumentFile } from "../../../server/modules/finanzamt/index.ts";
import { loadFile } from "../../../server/storage.ts";

/** Ein aus dem ELSTER-Postfach abgeholtes Dokument (Bescheid, Mitteilung) */
export const Route = createFileRoute("/api/postfach/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await postfachDocumentFile(id.data);
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(await loadFile(file.sha256), file, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
