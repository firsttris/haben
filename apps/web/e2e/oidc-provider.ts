import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

/**
 * Ausschließlich lokaler Testanbieter für den Browserdurchlauf, niemals für den Betrieb verwenden. Wie Authelia liefert
 * er die Gruppen nur über UserInfo; im Formular gibt man E-Mail und Gruppen (durch Komma getrennt) an.
 */
const issuer = "http://127.0.0.1:3216";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const flows = new Map<string, URL>();
const codes = new Map<string, { flow: URL; email: string; groups: string[] }>();
const profiles = new Map<string, Record<string, unknown>>();
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, issuer);
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/.well-known/openid-configuration")
    return void res.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        id_token_signing_alg_values_supported: ["RS256"],
      }),
    );
  if (url.pathname === "/userinfo") {
    const profile = profiles.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    res.statusCode = profile ? 200 : 401;
    return void res.end(JSON.stringify(profile ?? { error: "invalid_token" }));
  }
  if (url.pathname === "/jwks")
    return void res.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] }));
  if (url.pathname === "/authorize") {
    const id = randomBytes(16).toString("hex");
    flows.set(id, url);
    res.setHeader("content-type", "text/html; charset=utf-8");
    return void res.end(
      `<html lang="de"><title>Testanbieter</title><h1>Testanbieter</h1><form method="post" action="/authenticate"><input type="hidden" name="flow" value="${id}"><label>E-Mail<input name="email" type="email" required></label><label>Gruppen<input name="groups"></label><button>Anmelden</button></form></html>`,
    );
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const params = new URLSearchParams(body);
  if (url.pathname === "/authenticate") {
    const id = params.get("flow")!;
    const flow = flows.get(id);
    flows.delete(id);
    if (!flow) {
      res.statusCode = 400;
      return void res.end("{}");
    }
    const code = randomBytes(16).toString("hex");
    const groups = (params.get("groups") ?? "")
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean);
    codes.set(code, { flow, email: params.get("email")!, groups });
    const callback = new URL(flow.searchParams.get("redirect_uri")!);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", flow.searchParams.get("state")!);
    res.writeHead(302, { location: callback.toString() });
    return void res.end();
  }
  if (url.pathname === "/token") {
    const id = params.get("code")!;
    const data = codes.get(id);
    codes.delete(id);
    if (
      !data ||
      req.headers.authorization !== `Basic ${Buffer.from("haben:secret").toString("base64")}` ||
      createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url") !== data.flow.searchParams.get("code_challenge")
    ) {
      res.statusCode = 400;
      return void res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: issuer,
      aud: "haben",
      sub: data.email,
      email: data.email,
      email_verified: true,
      name: "SSO-Test",
      iat: now,
      exp: now + 3600,
      nonce: data.flow.searchParams.get("nonce"),
    };
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const signature = sign("RSA-SHA256", Buffer.from(unsigned), keys.privateKey).toString("base64url");
    const accessToken = randomBytes(16).toString("hex");
    profiles.set(accessToken, { sub: data.email, email: data.email, email_verified: true, name: data.email.split("@")[0], groups: data.groups });
    return void res.end(JSON.stringify({ id_token: `${unsigned}.${signature}`, access_token: accessToken, token_type: "Bearer", expires_in: 3600 }));
  }
  res.statusCode = 404;
  res.end("{}");
});
server.listen(3216, "127.0.0.1");
