import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { orderDocumentFile } from "../../../server/modules/archiv/index.ts";
import { requireUser } from "../../../server/rollen.ts";
import { fileResponse } from "../../../server/file-response.ts";

export const Route = createFileRoute("/api/archiv/auftragsdatei/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "inhaber");
        if (user instanceof Response) return user;
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await orderDocumentFile(id.data);
        return file ? fileResponse(file.bytes, file, new URL(request.url).searchParams.has("download")) : new Response("Nicht gefunden", { status: 404 });
      },
    },
  },
});
