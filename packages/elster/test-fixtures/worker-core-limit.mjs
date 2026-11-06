// Stub-Worker: Die Shell erbt die Core-Grenze des Workers (getrlimit(2)); kein Linux-/proc nötig.
import { execFileSync } from "node:child_process";

process.once("message", () => {
  const soft = execFileSync("/bin/sh", ["-c", "ulimit -Sc"], { encoding: "utf8" }).trim();
  process.send({ type: "result", result: { code: 0, message: "OK", responseXml: soft } }, () => process.exit(0));
});
