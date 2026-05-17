import { type SDKMessage, type SessionConfig } from "./runner.js";
import {
  runRuntimeAgent,
  type AgentRuntimeSettings,
  type ProviderSessionState,
} from "./runtimes/index.js";

const TTL_MS = 15 * 60 * 1000; // 15 minutes

export type SessionStatus = "idle" | "busy";

export interface Session {
  appId: string;
  sessionState: ProviderSessionState | null;
  status: SessionStatus;
  createdAt: Date;
  lastActiveAt: Date;
  config: SessionConfig;
  ttlTimer: ReturnType<typeof setTimeout>;

  sendMessage(prompt: string, settings: AgentRuntimeSettings, workerBaseUrl?: string): AsyncGenerator<SDKMessage>;
  resetTTL(): void;
  ttlRemainingMs(): number;
  destroy(): void;
}

class SessionImpl implements Session {
  appId: string;
  sessionState: ProviderSessionState | null = null;
  status: SessionStatus = "idle";
  createdAt: Date;
  lastActiveAt: Date;
  config: SessionConfig;
  ttlTimer: ReturnType<typeof setTimeout>;

  private onExpiry: () => void;

  constructor(appId: string, config: SessionConfig, onExpiry: () => void) {
    this.appId = appId;
    this.config = config;
    this.createdAt = new Date();
    this.lastActiveAt = new Date();
    this.onExpiry = onExpiry;
    this.ttlTimer = setTimeout(() => this.onExpiry(), TTL_MS);
  }

  async *sendMessage(
    prompt: string,
    settings: AgentRuntimeSettings,
    workerBaseUrl?: string,
  ): AsyncGenerator<SDKMessage> {
    if (this.status === "busy") {
      throw new Error("Session is already processing another message. Reconnect to the active stream instead of starting a second message.");
    }

    this.status = "busy";
    this.resetTTL();

    try {
      for await (const msg of runRuntimeAgent({
        prompt,
        config: this.config,
        settings,
        sessionState: this.sessionState,
        workerBaseUrl,
      })) {
        if (msg.providerSessionState) {
          this.sessionState = msg.providerSessionState;
        } else if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
          this.sessionState = {
            runtimeId: settings.runtimeId,
            sessionId: msg.session_id,
            format: settings.runtimeId === "claude-code" ? "claude-jsonl" : `${settings.runtimeId}-session`,
          };
        }
        yield msg;
      }
    } finally {
      this.status = "idle";
      this.lastActiveAt = new Date();
      this.resetTTL();
    }
  }

  resetTTL(): void {
    clearTimeout(this.ttlTimer);
    this.ttlTimer = setTimeout(() => this.onExpiry(), TTL_MS);
    this.lastActiveAt = new Date();
  }

  ttlRemainingMs(): number {
    const elapsed = Date.now() - this.lastActiveAt.getTime();
    return Math.max(0, TTL_MS - elapsed);
  }

  destroy(): void {
    clearTimeout(this.ttlTimer);
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  get(appId: string): Session | undefined {
    return this.sessions.get(appId);
  }

  getOrCreate(
    appId: string,
    config: SessionConfig,
    resumeSessionState?: ProviderSessionState | null,
  ): Session {
    const existing = this.sessions.get(appId);
    if (existing) {
      existing.config = config;
      if (resumeSessionState !== undefined) {
        existing.sessionState = resumeSessionState;
      }
      return existing;
    }

    const session = new SessionImpl(appId, config, () => this.destroy(appId));
    if (resumeSessionState) {
      session.sessionState = resumeSessionState;
    }
    this.sessions.set(appId, session);
    return session;
  }

  destroy(appId: string): void {
    const session = this.sessions.get(appId);
    if (session) {
      session.destroy();
      this.sessions.delete(appId);
    }
  }

  listAll(): { appId: string; status: SessionStatus; sessionState: ProviderSessionState | null }[] {
    return Array.from(this.sessions.entries()).map(([appId, s]) => ({
      appId,
      status: s.status,
      sessionState: s.sessionState,
    }));
  }
}
