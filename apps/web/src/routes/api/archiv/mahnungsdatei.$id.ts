import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { legacyDunningFile } from "../../../server/modules/archiv/index.ts";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { loadFile } from "../../../server/storage.ts";

/** PDF einer Mahnung aus der bisherigen Buchhaltung */
export const Route = createFileRoute("/api/archiv/mahnungsdatei/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await legacyDunningFile(id.data);
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(await loadFile(file.sha256), file, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
