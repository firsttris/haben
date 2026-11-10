import { createHash } from "node:crypto";
import { ConfidentialClientApplication, type Configuration } from "@azure/msal-node";
import { MailError } from "../errors.ts";

/** Was für die Anmeldung der App nötig ist; das Geheimnis ist schon entschlüsselt und bleibt im Speicher */
export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  /** Client Secret oder privater Schlüssel (PEM), je nach `auth` */
  secret: string;
  auth: "secret" | "certificate";
  /** SHA-256-Fingerabdruck des Zertifikats (hex), nur bei `certificate` */
  thumbprint: string | null;
}

export type TokenProvider = () => Promise<string>;

/** Für Tests: eigener Netzwerkzugriff und feste Endpunkte statt der Abfrage bei Microsoft */
export type MsalOverrides = Pick<NonNullable<Configuration["system"]>, "networkClient"> & { authorityMetadata?: string };

const SCOPE = "https://graph.microsoft.com/.default";

let overrides: MsalOverrides | undefined;
export function setMsalOverridesForTests(value: MsalOverrides | undefined): void {
  overrides = value;
  current = undefined;
}

/** Eine Anwendung je Stand der Zugangsdaten: msal hält das Token im Speicher und erneuert es vor Ablauf selbst */
let current: { key: string; provider: TokenProvider } | undefined;

function create(credentials: GraphCredentials): TokenProvider {
  const { tenantId, clientId, secret, auth, thumbprint } = credentials;
  const app = new ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`,
      ...(auth === "secret" ? { clientSecret: secret } : { clientCertificate: { thumbprintSha256: thumbprint ?? "", privateKey: secret } }),
      ...(overrides?.authorityMetadata ? { authorityMetadata: overrides.authorityMetadata, knownAuthorities: ["login.microsoftonline.com"] } : {}),
    },
    ...(overrides?.networkClient ? { system: { networkClient: overrides.networkClient } } : {}),
  });
  return async () => {
    try {
      const result = await app.acquireTokenByClientCredential({ scopes: [SCOPE] });
      if (!result?.accessToken) throw new Error("Microsoft Entra ID hat kein Token geliefert.");
      return result.accessToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new MailError(`Die Anmeldung bei Microsoft Entra ID ist fehlgeschlagen: ${message.split("\n")[0]!.slice(0, 400)}`);
    }
  };
}

/** Der Tokenanbieter für diese Zugangsdaten; ändern sie sich, entsteht ein neuer (und das alte Token ist weg) */
export function tokenProviderFor(credentials: GraphCredentials): TokenProvider {
  const key = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  if (current?.key !== key) current = { key, provider: create(credentials) };
  return current.provider;
}
