import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../../../server/auth.ts";
import { DocumentError, uploadDocument } from "../../../server/documents.ts";

/** Ziel des Teilen-Menüs der installierten App (Web Share Target, siehe manifest.webmanifest) */
export const Route = createFileRoute("/api/belege/teilen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return Response.redirect(new URL("/login", request.url), 303);
        const form = await request.formData();
        const files = form.getAll("files").filter((f): f is File => f instanceof File).slice(0, 20);
        let last: string | undefined;
        for (const file of files) {
          try {
            const result = await uploadDocument(
              session.user.id,
              { bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name },
              { background: (work) => void work.catch((error) => console.error("Belegauslesung", error)) },
            );
            last = result.id;
          } catch (error) {
            if (!(error instanceof DocumentError)) throw error;
          }
        }
        const target = files.length === 1 && last ? `/belege/${last}` : "/belege";
        return Response.redirect(new URL(target, request.url), 303);
      },
    },
  },
});
