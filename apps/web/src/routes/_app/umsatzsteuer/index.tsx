import { createFileRoute, redirect } from "@tanstack/react-router";
import { getOpenFilingPeriodKey } from "../../../server/functions/vat.ts";

export const Route = createFileRoute("/_app/umsatzsteuer/")({
  // Der Zeitraum, der noch abgegeben werden muss: solange das laufende Quartal bzw. der laufende Monat offen ist, dieser (#1099)
  beforeLoad: async () => {
    throw redirect({
      to: "/umsatzsteuer/$zeitraum",
      params: { zeitraum: await getOpenFilingPeriodKey() },
    });
  },
});
