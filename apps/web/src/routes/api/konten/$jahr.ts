import { kontenblattToCsv, saldenlisteToCsv } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../../../server/rollen.ts";
import { csvResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { kontenblatt, ledgerPeriodSchema, ledgerRange, saldenliste } from "../../../server/modules/buchhaltung/index.ts";

/** Saldenliste bzw. mit ?konto= das Kontenblatt eines Zeitraums als CSV */
export const Route = createFileRoute("/api/konten/$jahr")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await requireUser(request, "lesen");
        if (user instanceof Response) return user;
        const url = new URL(request.url);
        const year = yearSchema.safeParse(Number(params.jahr));
        const period = ledgerPeriodSchema.safeParse(url.searchParams.get("zeitraum") ?? undefined);
        const konto = url.searchParams.get("konto");
        if (!year.success || !period.success || (konto !== null && !/^\d{4,8}$/.test(konto))) {
          return new Response("Nicht gefunden", { status: 404 });
        }
        const range = ledgerRange(year.data, period.data);
        let csv: string;
        let filename: string;
        if (konto) {
          const blatt = await kontenblatt(konto, range);
          csv = kontenblattToCsv(blatt.eroeffnung, blatt.zeilen);
          filename = `konto-${konto}-${year.data}-${period.data}.csv`;
        } else {
          csv = saldenlisteToCsv(await saldenliste(range));
          filename = `saldenliste-${year.data}-${period.data}.csv`;
        }
        return csvResponse(csv, filename);
      },
    },
  },
});
