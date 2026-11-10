import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

/** TLS vor dem unveränderten Produktionsbuild, wie im Betrieb der Reverse Proxy. Nur im isolierten E2E-Lauf. */
const child = spawn(process.execPath, [".output/server/index.mjs"], { env: { ...process.env, PORT: "3219" }, stdio: "inherit" });
const proxy = createServer({ cert: readFileSync(process.env.SSO_E2E_TLS_CERT!), key: readFileSync(process.env.SSO_E2E_TLS_KEY!) }, (req, res) => {
  const upstream = request(
    { hostname: "127.0.0.1", port: 3219, path: req.url, method: req.method, headers: { ...req.headers, "x-forwarded-proto": "https" } },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
proxy.listen(3218, "127.0.0.1");
child.on("exit", (code) => {
  proxy.close();
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    proxy.close();
    child.kill(signal);
  });
