import { decrypt } from "../../crypto.ts";
import { MailError } from "./errors.ts";
import { createGraphTransport } from "./graph/send.ts";
import { tokenProviderFor } from "./graph/token.ts";
import type { MailSettingsRow, MailTransport } from "./transport.ts";

/**
 * Microsoft Graph (Exchange Online): App-only mit Client Secret oder Zertifikat, Versand als Postfach `graph_mailbox`, sonst
 * als Absenderadresse; das kann ein Benutzerpostfach oder eine Shared Mailbox sein.
 */
export function graphTransport(settings: MailSettingsRow): MailTransport {
  const { graphTenantId, graphClientId, graphAuth, graphThumbprint, ciphertext } = settings;
  // Die Tabelle erzwingt das für `graph` (CHECK mail_settings_transport); die Prüfung ist für die Typen
  if (
    graphTenantId === null ||
    graphClientId === null ||
    graphAuth === null ||
    ciphertext === null ||
    (graphAuth === "certificate" && graphThumbprint === null)
  ) {
    throw new MailError("Der Zugang für Microsoft 365 ist unvollständig.");
  }
  const tokenProvider = tokenProviderFor({
    tenantId: graphTenantId,
    clientId: graphClientId,
    auth: graphAuth,
    thumbprint: graphThumbprint,
    secret: new TextDecoder().decode(decrypt(ciphertext)),
  });
  return createGraphTransport(settings.graphMailbox || settings.fromAddress, { tokenProvider });
}
