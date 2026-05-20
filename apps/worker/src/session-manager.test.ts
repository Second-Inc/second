import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "./session-manager.js";
import type { SessionConfig } from "./runner.js";
import type { ProviderSessionState } from "./runtimes/index.js";

const config: SessionConfig = {
  systemPrompt: "test",
  workingDirectory: "/tmp/second-test-app",
};

test("keeps live session state when persisted state targets the same provider session", () => {
  const manager = new SessionManager();
  const liveState: ProviderSessionState = {
    runtimeId: "claude-code",
    sessionId: "session-1",
    data: "live-jsonl",
  };
  const persistedState: ProviderSessionState = {
    runtimeId: "claude-code",
    sessionId: "session-1",
    data: "older-jsonl",
  };

  const session = manager.getOrCreate("app-1", config, liveState);
  const sameSession = manager.getOrCreate("app-1", config, persistedState);

  assert.equal(sameSession, session);
  assert.equal(sameSession.sessionState?.data, "live-jsonl");
  manager.destroy("app-1");
});

test("replaces live session state for a different provider session", () => {
  const manager = new SessionManager();
  manager.getOrCreate("app-1", config, {
    runtimeId: "claude-code",
    sessionId: "session-1",
    data: "live-jsonl",
  });

  const session = manager.getOrCreate("app-1", config, {
    runtimeId: "codex-cli",
    sessionId: "thread-1",
  });

  assert.equal(session.sessionState?.runtimeId, "codex-cli");
  assert.equal(session.sessionState?.sessionId, "thread-1");
  manager.destroy("app-1");
});

test("can intentionally clear provider session state", () => {
  const manager = new SessionManager();
  manager.getOrCreate("app-1", config, {
    runtimeId: "claude-code",
    sessionId: "session-1",
    data: "live-jsonl",
  });

  const session = manager.getOrCreate("app-1", config, null);

  assert.equal(session.sessionState, null);
  manager.destroy("app-1");
});
