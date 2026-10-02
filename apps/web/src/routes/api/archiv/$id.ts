import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { loadArchiveFile } from "../../../server/archive.ts";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";

/** Originaldatei aus dem Archiv (DATEV, IDEA, Protokolle, Kontoauszüge) */
export const Route = createFileRoute("/api/archiv/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await loadArchiveFile(id.data);
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(file.bytes, file, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
