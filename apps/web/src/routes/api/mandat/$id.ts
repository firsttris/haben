import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { mandateFile } from "../../../server/modules/stammdaten/index.ts";
import { loadFile } from "../../../server/storage.ts";

/** Unterschriebenes SEPA-Lastschriftmandat (#445) als PDF, das zuletzt hinterlegte */
export const Route = createFileRoute("/api/mandat/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await mandateFile(id.data);
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(await loadFile(file.sha256), { ...file, mimeType: "application/pdf" }, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
