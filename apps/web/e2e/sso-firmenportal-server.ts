import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

/*
 * TLS vor dem unveränderten Firmenportal (#504), wie im Betrieb der Reverse Proxy und wie sso-production-server.ts vor
 * Haben. Nur im isolierten SSO-Durchlauf: Über HTTP speichern Safari und WebKit die Secure-Cookies des Firmenportals
 * auf localhost nicht, so läuft der Durchlauf auch dort.
 */
const child = spawn(process.execPath, ["../firmenportal/src/main.ts"], { env: { ...process.env, PORT: "3221" }, stdio: "inherit" });
const proxy = createServer({ cert: readFileSync(process.env.SSO_E2E_TLS_CERT!), key: readFileSync(process.env.SSO_E2E_TLS_KEY!) }, (req, res) => {
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 3221,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, "x-forwarded-for": req.socket.remoteAddress ?? "", "x-forwarded-proto": "https" },
    },
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
proxy.listen(3217, "127.0.0.1");
child.on("exit", (code) => {
  proxy.close();
  process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    proxy.close();
    child.kill(signal);
  });
