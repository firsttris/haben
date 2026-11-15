import { createFileRoute } from "@tanstack/react-router";
import { createHealthCheck } from "../../server/db/health.ts";
import { db } from "../../server/db/index.ts";

export const Route = createFileRoute("/api/health")({
  server: { handlers: { GET: createHealthCheck(db.$client) } },
});
