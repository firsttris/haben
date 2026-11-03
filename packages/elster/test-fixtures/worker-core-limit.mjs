// Stub-Worker: meldet seine Grenze für Core-Dumps (soft, aus /proc/self/limits).
import { readFileSync } from "node:fs";

process.once("message", () => {
  const line = readFileSync("/proc/self/limits", "utf8")
    .split("\n")
    .find((l) => l.startsWith("Max core file size"));
  const soft = line?.split(/\s{2,}/)[1] ?? "?";
  process.send({ type: "result", result: { code: 0, message: "OK", responseXml: soft } }, () => process.exit(0));
});
