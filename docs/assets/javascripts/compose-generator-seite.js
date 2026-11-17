// @ts-check
/* Formular und Ausgabe des Compose-Generators (docs/compose-generator.md); die Logik steht in compose-generator.js. */
import { envFile, newSecrets, normalizeDomain, overrideFile, passwordError, startCommands } from "./compose-generator.js";

/** @typedef {import("./compose-generator.js").Config} Config */
/** @typedef {{ env: string, override: string, commands: string }} Files */

/** @type {WeakMap<HTMLElement, Files>} */
const filesOf = new WeakMap();

/** @param {HTMLElement} root @param {string} id */
const input = (root, id) => /** @type {HTMLInputElement | null} */ (root.querySelector(`#${id}`));

/** @param {HTMLElement} root @param {string} id */
const value = (root, id) => input(root, id)?.value.trim() ?? "";

/** @param {HTMLElement} root @param {string} id */
const checked = (root, id) => Boolean(input(root, id)?.checked);

/** @param {HTMLElement} root @returns {Config} */
const readConfig = (root) => ({
  domain: normalizeDomain(value(root, "cg-domain")) || "haben.example.de",
  registry: /** @type {Config["registry"]} */ (value(root, "cg-registry") || "dockerhub"),
  imageTag: value(root, "cg-image-tag") === "custom" ? value(root, "cg-image-tag-custom") || "latest" : value(root, "cg-image-tag") || "latest",
  proxyMode: /** @type {Config["proxyMode"]} */ (root.querySelector('input[name="cg-proxy-mode"]:checked')?.getAttribute("value") ?? "caddy"),
  proxyNetwork: value(root, "cg-proxy-network") || "proxy",
  dbPassword: value(root, "cg-db-password"),
  appDbPassword: value(root, "cg-app-db-password"),
  authSecret: value(root, "cg-auth-secret"),
  encryptionKey: value(root, "cg-encryption-key"),
  resticPassword: value(root, "cg-restic-password"),
  ericAutoInstall: checked(root, "cg-eric-auto"),
  arm64: checked(root, "cg-arm64"),
  aiMode: /** @type {Config["aiMode"]} */ (value(root, "cg-ai-mode") || "none"),
  extractionBaseUrl: value(root, "cg-extraction-url"),
  extractionModel: value(root, "cg-extraction-model"),
  backupMode: /** @type {Config["backupMode"]} */ (value(root, "cg-backup-mode") || "local"),
  resticRepository: value(root, "cg-restic-repo"),
  backupTime: value(root, "cg-backup-time"),
  restoreCheckDays: value(root, "cg-restore-days"),
  oidcOnly: checked(root, "cg-oidc-only"),
  oidcIssuer: value(root, "cg-oidc-issuer"),
  oidcClientId: value(root, "cg-oidc-client-id"),
  oidcDisplayName: value(root, "cg-oidc-display-name"),
  oidcGroupsClaim: value(root, "cg-oidc-groups-claim"),
  oidcGroupInhaber: value(root, "cg-oidc-group-inhaber"),
  oidcGroupSteuerberatung: value(root, "cg-oidc-group-steuer"),
});

/** @param {HTMLElement} root @param {string} id @param {boolean} show */
const toggle = (root, id, show) => root.querySelector(`#${id}`)?.classList.toggle("cg-hidden", !show);

/** @param {HTMLElement} root @param {string} tabName */
const activateTab = (root, tabName) => {
  for (const tab of root.querySelectorAll("[data-cg-tab]")) tab.setAttribute("aria-selected", String(tab.getAttribute("data-cg-tab") === tabName));
  for (const panel of root.querySelectorAll("[data-cg-panel]")) panel.classList.toggle("cg-hidden", panel.getAttribute("data-cg-panel") !== tabName);
};

/** @param {HTMLElement} root @param {Config} cfg @param {boolean} withOverride */
const updateVisibility = (root, cfg, withOverride) => {
  toggle(root, "cg-proxy-network-wrap", cfg.proxyMode === "proxy-docker");
  toggle(root, "cg-image-tag-custom-wrap", value(root, "cg-image-tag") === "custom");
  toggle(root, "cg-ai-url-wrap", cfg.aiMode === "ollama" || cfg.aiMode === "openai");
  toggle(root, "cg-backup-repo-wrap", cfg.backupMode !== "local");
  toggle(root, "cg-oidc-fields-wrap", cfg.oidcOnly);
  const openai = cfg.aiMode === "openai";
  input(root, "cg-extraction-url")?.setAttribute("placeholder", openai ? "https://openrouter.ai/api/v1" : "http://host.docker.internal:11434/v1");
  input(root, "cg-extraction-model")?.setAttribute("placeholder", openai ? "qwen/qwen2.5-vl-72b-instruct" : "qwen2.5vl:7b");

  const overrideTab = /** @type {HTMLElement | null} */ (root.querySelector('[data-cg-tab="override"]'));
  if (!overrideTab) return;
  overrideTab.hidden = !withOverride;
  if (!withOverride && overrideTab.getAttribute("aria-selected") === "true") activateTab(root, "env");
};

/** Meldet ungültige Passwörter am Feld; true, wenn alle stimmen. @param {HTMLElement} root */
const checkPasswords = (root) =>
  ["cg-db-password", "cg-app-db-password"]
    .map((id) => {
      const error = passwordError(value(root, id));
      input(root, id)?.setAttribute("aria-invalid", String(error !== null));
      const message = root.querySelector(`#${id}-fehler`);
      if (message) message.textContent = error ?? "";
      return error === null;
    })
    .every(Boolean);

/** @param {HTMLElement} root */
const render = (root) => {
  const cfg = readConfig(root);
  const override = overrideFile(cfg);
  updateVisibility(root, cfg, override !== "");
  const valid = checkPasswords(root);
  const files = { env: valid ? envFile(cfg) : "", override, commands: startCommands(override !== "") };
  filesOf.set(root, files);
  const show = (/** @type {string} */ id, /** @type {string} */ text) => {
    const el = root.querySelector(`#${id}`);
    if (el) el.textContent = text;
  };
  show("cg-out-env", files.env || "# Erst die Passwörter unter „Passwörter und Schlüssel“ korrigieren.");
  show("cg-out-override", files.override);
  show("cg-out-commands", files.commands);
};

/** @param {HTMLElement} root */
const fillSecrets = (root) => {
  const secrets = newSecrets();
  const fields = {
    "cg-db-password": secrets.dbPassword,
    "cg-app-db-password": secrets.appDbPassword,
    "cg-auth-secret": secrets.authSecret,
    "cg-encryption-key": secrets.encryptionKey,
    "cg-restic-password": secrets.resticPassword,
  };
  for (const [id, secret] of Object.entries(fields)) {
    const field = input(root, id);
    if (field) field.value = secret;
  }
};

/** @param {HTMLElement} button @param {string} text */
const copy = async (button, text) => {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Kopiert";
  } catch {
    button.textContent = "Kopieren fehlgeschlagen";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
};

/** @param {string} filename @param {string} content */
const download = (filename, content) => {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

/** @param {HTMLElement} root */
const bindEvents = (root) => {
  root.addEventListener("input", () => render(root));
  root.addEventListener("change", () => render(root));
  root.querySelector("#cg-regen-all")?.addEventListener("click", () => {
    fillSecrets(root);
    render(root);
  });
  root.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement | null} */ (event.target instanceof Element ? event.target.closest("button") : null);
    const files = filesOf.get(root);
    if (!button || !files) return;
    const tab = button.dataset.cgTab;
    const key = /** @type {keyof Files | undefined} */ (button.dataset.cgCopy ?? button.dataset.cgDownload);
    if (tab) activateTab(root, tab);
    else if (button.id === "cg-copy-app-pw") copy(button, value(root, "cg-app-db-password"));
    else if (key && files[key] && button.dataset.cgCopy) copy(button, files[key]);
    else if (key && files[key]) download(key === "env" ? ".env" : "compose.override.yml", files[key]);
  });
};

const init = () => {
  const root = document.getElementById("cg-app");
  if (!root || root.dataset.cgReady === "true") return;
  root.dataset.cgReady = "true";
  fillSecrets(root);
  bindEvents(root);
  render(root);
};

// Ein Modul läuft nur einmal je Adresse; kommt man über die Navigation ohne Neuladen (navigation.instant) zurück,
// meldet Zensical die neue Seite über document$. init prüft selbst, ob die Seite den Generator enthält.
/** @type {{ document$?: { subscribe: (next: () => void) => void } }} */
const zensical = /** @type {never} */ (globalThis);
zensical.document$?.subscribe(init);
init();
