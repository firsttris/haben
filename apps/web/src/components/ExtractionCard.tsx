import type { getExtractionSettings } from "../server/functions/documents.ts";

type Settings = Awaited<ReturnType<typeof getExtractionSettings>>;

export const EXTRACTION_DOCS = "https://firsttris.github.io/haben/einrichtung.html#ki-auslesung-von-belegen";

const PROVIDER = {
  anthropic: "Anthropic (Claude, Cloud)",
  "openai-compatible": "Eigener Dienst (OpenAI-kompatibel)",
} as const;

/** Einstellungen → KI-Assistenten und API: wer Belege ausliest. Eingestellt wird über Umgebungsvariablen, hier nur angezeigt. */
export function ExtractionCard({ settings }: { settings: Settings }) {
  const docs = (
    <a href={EXTRACTION_DOCS} target="_blank" rel="noreferrer">
      Belegauslesung einrichten
    </a>
  );
  return (
    <section className="card" aria-labelledby="extraction-heading">
      <h2 id="extraction-heading">Belegauslesung</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        E-Rechnungen liest Haben immer selbst. Andere PDFs und Fotos füllt auf Wunsch ein Modell vor: Claude über die Anthropic-API oder ein selbst betriebenes
        Vision-Modell, etwa mit Ollama, LM Studio oder vLLM. Die Felder bleiben „Zu prüfen“, bis du sie bestätigst. Eingestellt wird die Auslesung über
        Umgebungsvariablen auf dem Server.
      </p>
      {settings.provider === null ? (
        <div className="banner banner-info">Die KI-Auslesung ist aus. Belege, die keine E-Rechnung sind, füllst du von Hand aus. {docs}</div>
      ) : (
        <>
          <dl className="small" style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px" }}>
            <dt className="muted">Anbieter</dt>
            <dd style={{ margin: 0 }}>{PROVIDER[settings.provider]}</dd>
            <dt className="muted">Modell</dt>
            <dd className="mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {settings.model}
            </dd>
            {settings.endpoint && (
              <>
                <dt className="muted">Adresse</dt>
                <dd className="mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
                  {settings.endpoint}
                </dd>
                <dt className="muted">Schlüssel</dt>
                <dd style={{ margin: 0 }}>{settings.keySet ? "gesetzt" : "keiner"}</dd>
                <dt className="muted">PDF</dt>
                <dd style={{ margin: 0 }}>Die ersten {settings.maxPages} Seiten als Bilder</dd>
                <dt className="muted">Wartezeit</dt>
                <dd style={{ margin: 0 }}>{settings.timeoutSeconds} Sekunden</dd>
              </>
            )}
          </dl>
          <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
            {settings.provider === "openai-compatible"
              ? "Belege gehen nur an diesen Dienst. Ist er nicht erreichbar oder antwortet er falsch, steht der Fehler am Beleg; Haben weicht nicht auf einen anderen Anbieter aus."
              : "Belege gehen an die Anthropic-API."}{" "}
            {docs}
          </p>
        </>
      )}
    </section>
  );
}
