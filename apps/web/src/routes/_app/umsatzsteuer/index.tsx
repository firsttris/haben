import { currentFilingPeriod, periodKey } from "@haben/core";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/umsatzsteuer/")({
  beforeLoad: () => {
    throw redirect({
      to: "/umsatzsteuer/$zeitraum",
      params: { zeitraum: periodKey(currentFilingPeriod(new Date())) },
    });
  },
});
