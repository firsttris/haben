import { type ClientResponse, FinTSClient, FinTSConfig } from "lib-fints";

/**
 * Sparkasse KölnBonn, pushTAN 2.0 (923): Die Bank lehnte die Anmeldung ohne Medium mit
 * 9955 / MBV07390100255 ab und akzeptierte „Alle Geräte“. Das ist eine beobachtete Bankbesonderheit,
 * keine allgemeine Bedeutung von 9955 (DK: Ein-Schritt-TAN-Verfahren nicht zugelassen).
 * lib-fints 1.5.3 setzt sonst „default“ und übernimmt BPD aus abgelehnten Antworten nicht:
 * https://github.com/robocode13/lib-fints/blob/v1.5.3/src/dialog.ts (getTanMediaName)
 * https://github.com/robocode13/lib-fints/blob/v1.5.3/src/interactions/customerInteraction.ts (handleClientResponse)
 */
const PUSH = 923;
const MEDIUM = "Alle Geräte";
const ZULAESSIGE_FEHLER = new Set([9050, 9800, 9955]);
const ZUGANG_GESPERRT = new Set([3931, 3938]);

function bekannteBank(config: FinTSConfig): boolean {
  const url = URL.parse(config.bankingUrl);
  return config.bankId === "37050198" && url?.protocol === "https:" && url.hostname === "banking-rl7.s-fints-pt-rl.de";
}

function unbekanntesMedium(client: FinTSClient, response: ClientResponse): boolean {
  const config = client.config;
  // Eine aktuelle 3920 darf eine ältere Erlaubnis aus gespeicherten BPD einschränken.
  const aktuellErlaubt = response.bankAnswers.find((a) => a.code === 3920);
  return (
    !response.success &&
    !response.requiresTan &&
    !!config.userId &&
    !!config.pin &&
    bekannteBank(config) &&
    !config.tanMediaName &&
    (!config.tanMethodId || config.tanMethodId === PUSH) &&
    (!aktuellErlaubt || !!aktuellErlaubt.params?.includes(String(PUSH))) &&
    response.bankAnswers.some((a) => a.code === 9955) &&
    !response.bankAnswers.some((a) => ZUGANG_GESPERRT.has(a.code) || (a.code >= 9000 && !ZULAESSIGE_FEHLER.has(a.code)))
  );
}

async function bankparameterErgaenzen(client: FinTSClient, response: ClientResponse): Promise<void> {
  const config = client.config;
  if (config.bankingInformation.bpd || config.tanMethodId) return;
  // 3920 gehört zum angemeldeten Zugang, nicht zur anonymen BPD-Abfrage. Keine PIN zum Ermitteln der BPD wiederholen.
  const erlaubt = response.bankAnswers.find((a) => a.code === 3920)?.params?.map(Number) ?? [];
  if (!erlaubt.includes(PUSH)) return;
  const oeffentlich = FinTSConfig.forFirstTimeUse(config.productId, config.productVersion, config.bankingUrl, config.bankId);
  try {
    const antwort = await new FinTSClient(oeffentlich).synchronize();
    if (!antwort.success || antwort.requiresTan || !oeffentlich.bankingInformation.bpd || !bekannteBank(oeffentlich)) return;
    config.bankingInformation.bpd = { ...oeffentlich.bankingInformation.bpd, availableTanMethodIds: erlaubt };
  } catch {
    // Die ursprüngliche Ablehnung bleibt maßgeblich; kein weiterer Anmeldeversuch bei fehlgeschlagenem BPD-Abruf.
  }
}

/** Einmaliger, eng begrenzter Fallback; synchronizeWithTan bleibt am Dialog des zweiten Versuchs. */
export async function synchronisierenMitSparkassenMedium(client: FinTSClient): Promise<ClientResponse> {
  const config = client.config;
  // Das Sondermedium gehört nur zu 923; nach Wahl eines anderen Verfahrens nicht mitsenden oder speichern.
  if (config.tanMediaName === MEDIUM && config.tanMethodId !== PUSH && bekannteBank(config)) config.tanMediaName = undefined;
  const response = await client.synchronize();
  if (!unbekanntesMedium(client, response)) return response;
  await bankparameterErgaenzen(client, response);
  const method = client.config.availableTanMethods.find((m) => m.id === PUSH);
  if (!method?.isDecoupled || method.tanMediaRequirement !== 2) return response;
  client.selectTanMethod(PUSH);
  // selectTanMedia verlangt bereits abgerufene Medien. Gerade deren Abruf scheitert hier beim Dialogaufbau.
  client.config.tanMediaName = MEDIUM;
  return client.synchronize();
}

/** Neue BPD ersetzen die Medienliste; das bei erfolgreicher Einrichtung gespeicherte Medium bleibt gültig. */
export function gespeichertesSparkassenMediumErgaenzen(config: FinTSConfig, medium: string): void {
  const method = config.selectedTanMethod;
  if (!bekannteBank(config) || config.tanMethodId !== PUSH || medium !== MEDIUM || !method?.isDecoupled || method.tanMediaRequirement !== 2) return;
  if (!method.activeTanMedia.includes(MEDIUM)) method.activeTanMedia.push(MEDIUM);
}
