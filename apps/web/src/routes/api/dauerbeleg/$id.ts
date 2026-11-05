import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { dauerbelegFile } from "../../../server/modules/belege/index.ts";
import { loadFile } from "../../../server/storage.ts";

/** Vertrag oder Dauerrechnung eines Dauerbelegs, wie zurzeit hinterlegt */
export const Route = createFileRoute("/api/dauerbeleg/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const file = await dauerbelegFile(id.data);
        if (!file) return new Response("Nicht gefunden", { status: 404 });
        return fileResponse(await loadFile(file.sha256), file, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
