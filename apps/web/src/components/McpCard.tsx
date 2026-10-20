import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { createMcpTokenFn, revokeMcpTokenFn, setMcpEnabledFn, type getMcpSettings } from "../server/functions/mcp.ts";

type Data = Awaited<ReturnType<typeof getMcpSettings>>;

export const MCP_DOCS = "https://firsttris.github.io/haben/ki-assistenten.html";

const STATUS = { aktiv: "pill-ok", abgelaufen: "pill-warn", widerrufen: "pill" } as const;

/** Einstellungen → KI-Assistenten: Zugang über MCP ein- und ausschalten, API-Tokens und Protokoll */
export function McpCard({ data }: { data: Data }) {
  const router = useRouter();
  const setEnabled = useServerFn(setMcpEnabledFn);
  const create = useServerFn(createMcpTokenFn);
  const revoke = useServerFn(revokeMcpTokenFn);
  const { busy, notice, run } = useAction();
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    void run(async () => {
      const { token } = await create({ data: { name, days: Number(values.get("days")) as 30 | 90 | 365 } });
      setCopied(false);
      setCreated({ name, token });
      form.reset();
      await router.invalidate();
    });
  }

  const command = created ? `claude mcp add --transport http haben ${endpoint} --header "Authorization: Bearer ${created.token}"` : "";

  return (
    <>
      <section className="card" aria-labelledby="mcp-heading">
        <h2 id="mcp-heading">KI-Assistenten (MCP)</h2>
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          Mit dem Model Context Protocol fragt ein KI-Assistent wie Claude Code, Claude Desktop oder ein lokales Modell deine Buchhaltung im Gespräch ab, etwa
          „Welche Rechnungen sind überfällig?“ oder „Wie viel Umsatzsteuer zahle ich im Oktober?“. Der Zugang kann nur lesen: Buchen, Festschreiben und Senden
          an ELSTER machst du weiter selbst in Haben.
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
          Zugang für KI-Assistenten einschalten
        </label>
        {data.enabled && (
          <p className="small muted" style={{ margin: 0 }}>
            Endpunkt: <span className="mono">{endpoint}</span>
          </p>
        )}
        <NoticeBanner notice={notice} />
      </section>

      {data.enabled && (
        <section className="card" aria-labelledby="mcp-token-heading">
          <h2 id="mcp-token-heading">API-Tokens</h2>
          <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
            Jeder Assistent bekommt ein eigenes Token, das du jederzeit widerrufen kannst. Haben speichert nur einen Hash; das Token siehst du nur direkt nach
            dem Anlegen.
          </p>
          {created && (
            <div className="stack" style={{ gap: 8 }}>
              <label className="field">
                Token für „{created.name}“ (wird nur jetzt angezeigt)
                <input readOnly className="mono" value={created.token} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <label className="field">
                In Claude Code eintragen
                <textarea readOnly className="mono" rows={3} value={command} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => void navigator.clipboard?.writeText(command).then(() => setCopied(true))}>
                  {copied ? "Kopiert" : "Befehl kopieren"}
                </button>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                Wer das Token hat, liest deine Buchhaltung. Gib es nicht weiter. Für Claude Desktop und andere Clients steht die Einrichtung in der{" "}
                <a href={MCP_DOCS} target="_blank" rel="noreferrer">
                  Anleitung
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
                    {token.name} <span className={`pill ${STATUS[token.status]}`}>{token.status}</span>
                  </span>
                  <span className="small muted">
                    <span className="mono">{token.prefix}…</span> · angelegt {formatDate(token.createdAt)} ·{" "}
                    {token.status === "widerrufen" ? `widerrufen ${formatDate(token.revokedAt!)}` : `gültig bis ${formatDate(token.expiresAt)}`} ·{" "}
                    {token.lastUsedAt ? `zuletzt benutzt ${formatDateTime(token.lastUsedAt)}` : "noch nicht benutzt"}
                  </span>
                </div>
                {token.status === "aktiv" && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await revoke({ data: { id: token.id } });
                        await router.invalidate();
                      }, "Token widerrufen.")
                    }
                  >
                    Widerrufen
                  </button>
                )}
              </div>
            ))
          )}
          <form className="form-grid" onSubmit={onCreate} aria-label="Neues Token">
            <label className="field">
              Name
              <input name="name" required maxLength={80} placeholder="Claude Code am Laptop" />
            </label>
            <label className="field">
              Gültig
              <select name="days" defaultValue="90">
                <option value="30">30 Tage</option>
                <option value="90">90 Tage</option>
                <option value="365">1 Jahr</option>
              </select>
            </label>
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
            Welcher Assistent wann welches Werkzeug benutzt hat, ohne Inhalte; Haben hebt das 90 Tage auf. Angeboten werden:{" "}
            {data.tools.map((t) => t.title).join(", ")}.
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
