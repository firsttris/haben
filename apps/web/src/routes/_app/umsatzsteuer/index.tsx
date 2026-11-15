import { createFileRoute, redirect } from "@tanstack/react-router";
import { getOpenFilingPeriodKey } from "../../../server/functions/vat.ts";

export const Route = createFileRoute("/_app/umsatzsteuer/")({
  // Der älteste abgelaufene Zeitraum, der weder gesendet noch vermerkt ist; nie der laufende (§ 18 Abs. 1 UStG, #1102)
  beforeLoad: async () => {
    throw redirect({
      to: "/umsatzsteuer/$zeitraum",
      params: { zeitraum: await getOpenFilingPeriodKey() },
    });
  },
});
