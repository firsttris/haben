import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { db, schema } from "../../../server/db/index.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { loadFile } from "../../../server/storage.ts";

/** Originaldatei eines Belegs */
export const Route = createFileRoute("/api/beleg/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const [doc] = await db
          .select({ sha256: schema.documents.sha256, mimeType: schema.documents.mimeType, filename: schema.documents.filename })
          .from(schema.documents)
          .where(eq(schema.documents.id, id.data));
        if (!doc) return new Response("Nicht gefunden", { status: 404 });

        return fileResponse(await loadFile(doc.sha256), doc, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
