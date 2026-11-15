import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { createMcpTokenFn, reactivateMcpTokenFn, revokeMcpTokenFn, setMcpEnabledFn, type getMcpSettings } from "../server/functions/mcp.ts";
import { Field } from "./Field.tsx";
import { Status, type StatusLook } from "./Status.tsx";

type Data = Awaited<ReturnType<typeof getMcpSettings>>;

export const MCP_DOCS = "https://haben.app/ki-assistenten.html";
export const API_DOCS = "https://haben.app/api.html";

const STATUS: Record<"aktiv" | "abgelaufen" | "widerrufen" | "deaktiviert" | "unbestaetigt", StatusLook> = {
  aktiv: { text: "Aktiv", tone: "ok" },
  abgelaufen: { text: "Abgelaufen", tone: "warn" },
  widerrufen: { text: "Widerrufen" },
  deaktiviert: { text: "Deaktiviert", tone: "warn" },
  unbestaetigt: { text: "Unbestätigt", tone: "warn", emphasis: "notice" },
};

/** Einstellungen → KI-Assistenten und API: Zugang ein- und ausschalten, API-Tokens mit Rechten und Protokoll */
export function McpCard({ data }: { data: Data }) {
  const router = useRouter();
  const setEnabled = useServerFn(setMcpEnabledFn);
  const create = useServerFn(createMcpTokenFn);
  const revoke = useServerFn(revokeMcpTokenFn);
  const reactivate = useServerFn(reactivateMcpTokenFn);
  const [takingOver, setTakingOver] = useState<Data["tokens"][number] | null>(null);
  const { busy, notice, run } = useAction();
  const [created, setCreated] = useState<{ name: string; token: string; scopes: string[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Data["tokens"][number] | null>(null);
  // Erst nach dem Hydrieren: der Server kennt die Adresse im Browser nicht, sonst wiche der Text ab (React #418)
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const endpoint = `${origin}/api/mcp`;
  const apiBase = `${origin}/api/v1`;
  const label = (scope: string) => data.scopes.find((s) => s.id === scope)?.label ?? scope;

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    const scopes = values.getAll("scopes").map(String) as Data["scopes"][number]["id"][];
    void run(async () => {
      const { token } = await create({ data: { name, days: Number(values.get("days")) as 30 | 90 | 365, scopes } });
      setCopied(false);
      setCreated({ name, token, scopes });
      form.reset();
      await router.invalidate();
    });
  }

  const command = created ? `claude mcp add --transport http haben ${endpoint} --header "Authorization: Bearer ${created.token}"` : "";

  return (
    <>
      <section className="card" aria-labelledby="mcp-heading">
        <h2 id="mcp-heading">KI-Assistenten (MCP) und REST-API</h2>
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          Mit dem Model Context Protocol fragt ein KI-Assistent wie Claude Code, Claude Desktop oder ein lokales Modell deine Buchhaltung im Gespräch ab, etwa
          „Welche Rechnungen sind überfällig?“ oder „Wie viel Umsatzsteuer zahle ich im Oktober?“. Der Zugang kann nur lesen: Buchen, Festschreiben und Senden
          an ELSTER machst du weiter selbst in Haben.
        </p>
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          Über die REST-API legen eigene Werkzeuge und Automationen Kontakte und Rechnungsentwürfe an, etwa aus Bestellungen bei Etsy oder eBay, und liefern
          Belege, etwa aus einem Dokumentenarchiv; sie landen unter Belege als „Zu prüfen“. Auch die API bucht nichts und schreibt nichts fest.{" "}
          <a href={API_DOCS} target="_blank" rel="noreferrer">
            Anleitung zur API
          </a>
        </p>
        <div className="banner banner-info" style={{ maxWidth: 760 }}>
          Was der Assistent liest, geht an den Anbieter des Modells, bei Claude also an die Server von Anthropic, auch wenn Haben nur im Heimnetz läuft. Ganz
          lokal bleibt es nur mit einem lokalen Modell. Zertifikat, PIN, Passwörter und Steuer-ID gibt Haben nie heraus.{" "}
          <a href={MCP_DOCS} target="_blank" rel="noreferrer">
            Mehr dazu
          </a>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={data.enabled}
            disabled={busy}
            onChange={(e) => {
              const enabled = e.currentTarget.checked;
              void run(async () => {
                await setEnabled({ data: { enabled } });
                if (!enabled) setCreated(null);
                await router.invalidate();
              });
            }}
          />
          Zugang für KI-Assistenten und API einschalten
        </label>
        {data.enabled && (
          <p className="small muted" style={{ margin: 0 }}>
            MCP: <span className="mono">{endpoint}</span> · REST-API: <span className="mono">{apiBase}</span> (Beschreibung:{" "}
            <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
              openapi.json
            </a>
            )
          </p>
        )}
        <NoticeBanner notice={notice} />
      </section>

      {data.enabled && (
        <section className="card" aria-labelledby="mcp-token-heading">
          <h2 id="mcp-token-heading">API-Tokens</h2>
          <ConfirmDialog
            open={revoking !== null}
            title={`${revoking?.oauth ? "Verbindung" : "Token"} „${revoking?.name}“ widerrufen?`}
            confirmLabel="Widerrufen"
            danger
            onConfirm={() => {
              if (!revoking) return;
              const { id } = revoking;
              void run(async () => {
                await revoke({ data: { id } });
                await router.invalidate();
              }, "Token widerrufen.");
            }}
            onClose={() => setRevoking(null)}
          >
            <p>
              {revoking?.oauth
                ? "Der Connector verliert sofort den Zugriff. Für neuen Zugriff verbindest du ihn im KI-Assistenten neu."
                : "Das Werkzeug verliert sofort den Zugriff. Für neuen Zugriff legst du ein neues Token an und trägst es dort ein."}
            </p>
          </ConfirmDialog>
          <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
            Jeder Assistent und jedes Werkzeug bekommt ein eigenes Token mit nur den Rechten, die es braucht, und du kannst es jederzeit widerrufen. Haben
            speichert nur einen Hash; das Token siehst du nur direkt nach dem Anlegen. Connectors aus claude.ai verbinden sich per OAuth ohne Token und stehen
            danach ebenfalls hier.
          </p>
          <ConfirmDialog
            open={takingOver !== null}
            title="Token übernehmen und reaktivieren?"
            confirmLabel="Übernehmen und reaktivieren"
            onClose={() => setTakingOver(null)}
            onConfirm={() => {
              if (!takingOver) return;
              const id = takingOver.id;
              void run(async () => {
                await reactivate({ data: { id } });
                await router.invalidate();
              }, "Token übernommen und reaktiviert.");
            }}
          >
            <p>Du übernimmst die Verantwortung für diesen Zugang. Der bisherige Token bleibt gültig; Rechte und Ablaufdatum bleiben erhalten.</p>
          </ConfirmDialog>
          {created && (
            <div className="stack" style={{ gap: 8 }}>
              <Field label={<>Token für „{created.name}“ (wird nur jetzt angezeigt)</>}>
                {(control) => <input {...control} readOnly className="mono" value={created.token} onFocus={(e) => e.currentTarget.select()} />}
              </Field>
              {created.scopes.includes("haben:lesen") && (
                <>
                  <Field label="In Claude Code eintragen">
                    {(control) => <textarea {...control} readOnly className="mono" rows={3} value={command} onFocus={(e) => e.currentTarget.select()} />}
                  </Field>
                  <div className="actions">
                    <button type="button" className="btn btn-primary" onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true))}>
                      {copied ? "Kopiert" : "Befehl kopieren"}
                    </button>
                  </div>
                </>
              )}
              {created.scopes.some((scope) => scope !== "haben:lesen") && (
                <p className="small muted" style={{ margin: 0 }}>
                  Für die REST-API: Adresse <span className="mono">{apiBase}</span>, Header{" "}
                  <span className="mono">Authorization: Bearer {created.token.slice(0, 7)}…</span>.
                </p>
              )}
              <p className="small muted" style={{ margin: 0 }}>
                Wer das Token hat, kann alles, was seine Rechte erlauben. Gib es nicht weiter. Die Einrichtung steht in den Anleitungen für{" "}
                <a href={MCP_DOCS} target="_blank" rel="noreferrer">
                  KI-Assistenten
                </a>{" "}
                und die{" "}
                <a href={API_DOCS} target="_blank" rel="noreferrer">
                  REST-API
                </a>
                .
              </p>
            </div>
          )}
          {data.tokens.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Noch kein Token.
            </p>
          ) : (
            data.tokens.map((token) => (
              <div key={token.id} className="history-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>
                    {token.name}{" "}
                    <Status tone={STATUS[token.status].tone} emphasis={STATUS[token.status].emphasis} inline>
                      {STATUS[token.status].text}
                    </Status>
                  </span>
                  <span className="small muted">
                    {token.oauth ? "OAuth-Verbindung" : <span className="mono">{token.prefix}…</span>} · angelegt {formatDate(token.createdAt)} ·{" "}
                    {token.status === "widerrufen" ? `widerrufen ${formatDate(token.revokedAt!)}` : `gültig bis ${formatDate(token.expiresAt)}`} ·{" "}
                    {token.lastUsedAt ? `zuletzt benutzt ${formatDateTime(token.lastUsedAt)}` : "noch nicht benutzt"}
                  </span>
                  <span className="small muted">Verantwortlich: {token.responsibleName ?? token.responsibleId ?? "Noch nicht zugeordnet"}</span>
                  {token.disabledAt && (
                    <span className="small muted">
                      Deaktiviert: {token.disabledReason === "inhaberrolle-entzogen" ? "Inhaberrolle entzogen" : "Verantwortung noch nicht zugeordnet"}
                    </span>
                  )}
                  {token.status === "unbestaetigt" && (
                    <span className="small muted">Gilt erst wieder, wenn der Verantwortliche sich angemeldet hat oder jemand den Token übernimmt.</span>
                  )}
                  <span className="small muted">Rechte: {token.scopes.map(label).join(" · ")}</span>
                </div>
                {token.canTakeOver && (
                  <button type="button" className="btn" disabled={busy} onClick={() => setTakingOver(token)}>
                    Übernehmen und reaktivieren
                  </button>
                )}
                {(token.status === "aktiv" || token.status === "deaktiviert" || token.status === "unbestaetigt") && (
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRevoking(token)}>
                    Widerrufen
                  </button>
                )}
              </div>
            ))
          )}
          <form className="form-grid" onSubmit={onCreate} aria-label="Neues Token">
            <Field label="Name">{(control) => <input {...control} name="name" required maxLength={80} placeholder="Claude Code am Laptop" />}</Field>
            <Field label="Gültig">
              {(control) => (
                <select {...control} name="days" defaultValue="90">
                  <option value="30">30 Tage</option>
                  <option value="90">90 Tage</option>
                  <option value="365">1 Jahr</option>
                </select>
              )}
            </Field>
            <fieldset style={{ border: 0, padding: 0, margin: 0, gridColumn: "1 / -1" }}>
              <legend className="small" style={{ fontWeight: 500, marginBottom: 4 }}>
                Rechte
              </legend>
              {data.scopes.map((scope) => (
                <label key={scope.id} className="checkbox">
                  <input type="checkbox" name="scopes" value={scope.id} defaultChecked={scope.id === "haben:lesen"} />
                  <span>
                    {scope.label} <span className="mono small muted">{scope.id}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="actions" style={{ gridColumn: "1 / -1" }}>
              <button type="submit" className="btn" disabled={busy}>
                Token anlegen
              </button>
            </div>
          </form>
        </section>
      )}

      {data.enabled && (
        <section className="card" aria-labelledby="mcp-log-heading">
          <h2 id="mcp-log-heading">Letzte Aufrufe</h2>
          <p className="small muted" style={{ margin: 0 }}>
            Welcher Zugang wann welches Werkzeug oder welchen Endpunkt der API benutzt hat, ohne Inhalte; Haben hebt das 90 Tage auf. KI-Assistenten werden
            angeboten: {data.tools.map((t) => t.title).join(", ")}.
          </p>
          {data.calls.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Noch keine Aufrufe.
            </p>
          ) : (
            data.calls.map((call) => (
              <div key={call.id} className="history-row small">
                <span>
                  <span className="mono">{call.tool}</span> · {call.client}
                </span>
                <span className="muted">
                  {formatDateTime(call.at)} · {call.ok ? `ok, ${call.durationMs} ms` : "Fehler"}
                </span>
              </div>
            ))
          )}
        </section>
      )}
    </>
  );
}
