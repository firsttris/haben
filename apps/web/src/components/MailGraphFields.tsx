import type { getMailSettings } from "../server/functions/mail.ts";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";

type Settings = Awaited<ReturnType<typeof getMailSettings>>["settings"];

export const GRAPH_DOCS = "https://haben.app/einrichtung.html#e-mail-über-microsoft-365";

/** Größer ist kein Zertifikat und kein Schlüssel im PEM-Format */
export const MAX_PEM_SIZE = 20 * 1024;

/** Felder für den Versand über Microsoft 365 (Exchange Online), Anmeldung der App mit Zertifikat oder Client Secret */
export function MailGraphFields({
  stored,
  auth,
  onAuthChange,
}: {
  stored: Settings;
  auth: "secret" | "certificate";
  onAuthChange: (auth: "secret" | "certificate") => void;
}) {
  const graph = stored?.transport === "graph" ? stored : null;
  const sameAuth = graph?.graphAuth === auth;
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        Haben meldet sich als App bei Microsoft Entra ID an und sendet über Microsoft Graph, auch aus einer Shared Mailbox. Die App braucht die Berechtigung
        Mail.Send (Application); beschränke sie auf die Postfächer, aus denen Haben senden soll.{" "}
        <a href={GRAPH_DOCS} target="_blank" rel="noreferrer">
          Einrichtung Schritt für Schritt
        </a>
        . Das Geheimnis liegt verschlüsselt in der Datenbank.
      </p>
      <div className="form-row cols-2">
        <Field label="Verzeichnis-ID (Tenant)" hint="GUID oder Domäne, z. B. firma.onmicrosoft.com">
          {(control) => <input {...control} name="graphTenantId" defaultValue={graph?.graphTenantId ?? ""} autoComplete="off" required />}
        </Field>
        <Field label="Anwendungs-ID (Client)">
          {(control) => <input {...control} name="graphClientId" defaultValue={graph?.graphClientId ?? ""} autoComplete="off" required />}
        </Field>
      </div>
      <Field label="Anmeldung der App">
        {(control) => (
          <select {...control} value={auth} onChange={(e) => onAuthChange(e.target.value as "secret" | "certificate")}>
            <option value="certificate">Zertifikat (empfohlen)</option>
            <option value="secret">Client Secret</option>
          </select>
        )}
      </Field>
      {auth === "secret" ? (
        <Field label="Client Secret" hint="Läuft nach höchstens 24 Monaten ab; danach ein neues eintragen.">
          {(control) => (
            <input
              {...control}
              name="clientSecret"
              type="password"
              autoComplete="new-password"
              placeholder={graph && sameAuth ? "unverändert lassen" : undefined}
            />
          )}
        </Field>
      ) : (
        <div className="form-row cols-2">
          <Field
            label="Zertifikat (PEM)"
            hint={
              graph && sameAuth && graph.graphThumbprint
                ? `Gespeichert, Fingerabdruck ${graph.graphThumbprint.slice(0, 16)} … Leer lassen, um es zu behalten.`
                : "Der öffentliche Teil, den du auch in Entra ID hochlädst."
            }
          >
            {(control) => <FilePicker {...control} name="certificate" accept=".pem,.crt,.cer" />}
          </Field>
          <Field label="Privater Schlüssel (PEM)" hint="Ohne Passwort. Bleibt verschlüsselt auf dem Server.">
            {(control) => <FilePicker {...control} name="privateKey" accept=".pem,.key" />}
          </Field>
        </div>
      )}
      <Field label="Postfach" hint="Nur nötig, wenn es von der Absenderadresse abweicht: Benutzerprinzipalname (UPN) oder Objekt-ID.">
        {(control) => <input {...control} name="graphMailbox" type="text" defaultValue={graph?.graphMailbox ?? ""} autoComplete="off" />}
      </Field>
    </>
  );
}
