import { beforeEach, describe, expect, it, vi } from "vitest";

/** Gemockter ImapFlow: nur die Fähigkeiten, die der Server meldet, und was der Adapter danach aufruft */
const state = { capabilities: new Map<string, boolean>(), calls: [] as string[] };

vi.mock("imapflow", () => ({
  ImapFlow: class {
    capabilities = state.capabilities;
    async connect() {
      state.calls.push("connect");
    }
    async getMailboxLock() {
      state.calls.push("lock");
      return { release: () => {} };
    }
    async logout() {
      state.calls.push("logout");
    }
  },
}));

const { imapConnect, InboxError } = await import("./inbox-imap.ts");

const settings = (afterFetch: "seen" | "move" | "delete") =>
  ({ host: "imap.example.com", port: 993, secure: true, username: "u", afterFetch }) as Parameters<typeof imapConnect>[0];

describe("IMAP: gezielt löschen und verschieben (RFC 4315)", () => {
  beforeEach(() => {
    state.capabilities = new Map();
    state.calls = [];
  });

  it.each([
    ["delete", []],
    ["delete", ["MOVE"]],
    ["move", []],
  ] as const)("meldet „%s“ bei den Fähigkeiten %j vor dem Öffnen des Ordners", async (afterFetch, caps) => {
    state.capabilities = new Map(caps.map((cap) => [cap, true]));
    await expect(imapConnect(settings(afterFetch), "pw", "Belege")).rejects.toBeInstanceOf(InboxError);
    expect(state.calls).toEqual(["connect", "logout"]);
  });

  it.each([
    ["delete", ["UIDPLUS"]],
    ["move", ["MOVE"]],
    ["move", ["UIDPLUS"]],
    ["seen", []],
  ] as const)("lässt „%s“ bei den Fähigkeiten %j zu", async (afterFetch, caps) => {
    state.capabilities = new Map(caps.map((cap) => [cap, true]));
    const connection = await imapConnect(settings(afterFetch), "pw", "Belege");
    await connection.close();
    expect(state.calls).toEqual(["connect", "lock", "logout"]);
  });
});
