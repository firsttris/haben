import { kontenblattToCsv, saldenlisteToCsv } from "@haben/core";
import { createFileRoute } from "@tanstack/react-router";
import { lesend } from "../../../server/lese-route.ts";
import { csvResponse } from "../../../server/file-response.ts";
import { yearSchema } from "../../../server/functions/schemas.ts";
import { kontenblatt, ledgerPeriodSchema, ledgerRange, ledgerRangeVonBis, ledgerVonBisSchema, saldenliste } from "../../../server/modules/buchhaltung/index.ts";

/** Saldenliste bzw. mit ?konto= das Kontenblatt eines Zeitraums als CSV; das Kontenblatt auch mit ?von=&bis= im Jahr */
export const Route = createFileRoute("/api/konten/$jahr")({
  server: {
    handlers: {
      GET: lesend<"jahr">(async ({ request, params }) => {
        const url = new URL(request.url);
        const year = yearSchema.safeParse(Number(params.jahr));
        const period = ledgerPeriodSchema.safeParse(url.searchParams.get("zeitraum") ?? undefined);
        const konto = url.searchParams.get("konto");
        const von = url.searchParams.get("von");
        const vonBis = von === null ? null : ledgerVonBisSchema.safeParse({ von, bis: url.searchParams.get("bis") });
        if (
          !year.success ||
          !period.success ||
          (konto !== null && !/^\d{4,8}$/.test(konto)) ||
          (vonBis && (!vonBis.success || konto === null || !vonBis.data.von.startsWith(String(year.data))))
        ) {
          return new Response("Nicht gefunden", { status: 404 });
        }
        const range = vonBis?.success ? ledgerRangeVonBis(vonBis.data) : ledgerRange(year.data, period.data);
        let csv: string;
        let filename: string;
        if (konto) {
          const blatt = await kontenblatt(konto, range);
          csv = kontenblattToCsv(blatt.eroeffnung, blatt.zeilen);
          filename = vonBis?.success ? `konto-${konto}-${vonBis.data.von}-${vonBis.data.bis}.csv` : `konto-${konto}-${year.data}-${period.data}.csv`;
        } else {
          csv = saldenlisteToCsv(await saldenliste(range));
          filename = `saldenliste-${year.data}-${period.data}.csv`;
        }
        return csvResponse(csv, filename);
      }),
    },
  },
});
