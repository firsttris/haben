import { describe, expect, it } from "vitest";
import { chatCompletionsUrl, extractionConfig, extractionSettings } from "./extraction-config.ts";

const base = { EXTRACTION_TIMEOUT_SECONDS: 300, EXTRACTION_MAX_PAGES: 4 };

describe("Anbieterwahl der Belegauslesung", () => {
  it("ohne Einrichtung keine Auslesung", () => {
    expect(extractionConfig(base)).toBeNull();
  });

  it("nur Anthropic-Schlüssel: Anthropic wie bisher", () => {
    expect(extractionConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" })).toEqual({ provider: "anthropic", model: "claude-opus-5-5", apiKey: "sk-ant-x" });
  });

  it("eigener Dienst gewinnt, auch wenn zusätzlich ein Anthropic-Schlüssel gesetzt ist", () => {
    const config = extractionConfig({
      ...base,
      ANTHROPIC_API_KEY: "sk-ant-x",
      EXTRACTION_BASE_URL: "http://host.docker.internal:11434/v1",
      EXTRACTION_MODEL: "qwen2.5vl:7b",
    });
    expect(config).toEqual({
      provider: "openai-compatible",
      model: "qwen2.5vl:7b",
      endpoint: "http://host.docker.internal:11434/v1/chat/completions",
      apiKey: null,
      timeoutMs: 300_000,
      maxPages: 4,
    });
    expect(JSON.stringify(config)).not.toContain("sk-ant");
  });

  it("ausdrücklich gewählter Anbieter gilt", () => {
    const local = { EXTRACTION_BASE_URL: "http://vllm:8000/v1", EXTRACTION_MODEL: "Qwen/Qwen2.5-VL-7B-Instruct", EXTRACTION_API_KEY: "token" };
    expect(extractionConfig({ ...base, ...local, ANTHROPIC_API_KEY: "sk-ant-x", EXTRACTION_PROVIDER: "anthropic" })?.provider).toBe("anthropic");
    expect(extractionConfig({ ...base, ...local, EXTRACTION_PROVIDER: "openai-compatible" })).toMatchObject({ provider: "openai-compatible", apiKey: "token" });
    // Anthropic gewählt, aber ohne Schlüssel: aus, nicht der eigene Dienst
    expect(extractionConfig({ ...base, ...local, EXTRACTION_PROVIDER: "anthropic" })).toBeNull();
  });

  it("eigener Dienst gewählt, aber unvollständig: aus, nie Anthropic", () => {
    expect(extractionConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x", EXTRACTION_PROVIDER: "openai-compatible" })).toBeNull();
    expect(extractionConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x", EXTRACTION_BASE_URL: "http://ollama:11434/v1" })).toBeNull();
  });

  it("Pfad zu /chat/completions", () => {
    expect(chatCompletionsUrl("http://ollama:11434/v1")).toBe("http://ollama:11434/v1/chat/completions");
    expect(chatCompletionsUrl("http://ollama:11434/v1/")).toBe("http://ollama:11434/v1/chat/completions");
    expect(chatCompletionsUrl("http://lmstudio:1234/v1/chat/completions")).toBe("http://lmstudio:1234/v1/chat/completions");
  });

  it("Anzeige ohne Schlüssel und ohne Zugangsdaten in der Adresse", () => {
    const config = extractionConfig({
      ...base,
      EXTRACTION_BASE_URL: "https://nutzer:passwort@ki.example.de/v1?token=abc",
      EXTRACTION_MODEL: "qwen2.5vl:7b",
      EXTRACTION_API_KEY: "geheim",
    });
    const settings = extractionSettings(config);
    expect(settings).toEqual({
      provider: "openai-compatible",
      model: "qwen2.5vl:7b",
      endpoint: "https://ki.example.de/v1/chat/completions",
      keySet: true,
      maxPages: 4,
      timeoutSeconds: 300,
    });
    expect(extractionSettings(extractionConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" }))).toMatchObject({ provider: "anthropic", keySet: true });
    expect(JSON.stringify(extractionSettings(extractionConfig({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" })))).not.toContain("sk-ant");
  });
});
