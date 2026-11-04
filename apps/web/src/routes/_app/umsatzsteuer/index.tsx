import { createFileRoute, redirect } from "@tanstack/react-router";
import { getFilingPeriodKey } from "../../../server/functions/vat.ts";

export const Route = createFileRoute("/_app/umsatzsteuer/")({
  // Der zuletzt abgelaufene Zeitraum nach dem eingestellten Voranmeldungszeitraum: Vormonat oder letztes volles Quartal
  beforeLoad: async () => {
    throw redirect({
      to: "/umsatzsteuer/$zeitraum",
      params: { zeitraum: await getFilingPeriodKey() },
    });
  },
});
