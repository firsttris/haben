import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "../../../server/auth.ts";
import { fileResponse } from "../../../server/file-response.ts";
import { vastBelegXml } from "../../../server/vast.ts";

/** Ein von ELSTER abgeholter Beleg als XML, wie er entschlüsselt ankam */
export const Route = createFileRoute("/api/vast/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth().api.getSession({ headers: request.headers });
        if (!session) return new Response("Nicht angemeldet", { status: 401 });
        const id = z.uuid().safeParse(params.id);
        if (!id.success) return new Response("Nicht gefunden", { status: 404 });
        const beleg = await vastBelegXml(id.data);
        if (!beleg) return new Response("Nicht gefunden", { status: 404 });
        const file = { mimeType: "application/xml", filename: `${beleg.belegart}_${beleg.year}.xml` };
        return fileResponse(new TextEncoder().encode(beleg.xml), file, new URL(request.url).searchParams.has("download"));
      },
    },
  },
});
