import { type SDKMessage, type SessionConfig } from "./runner.js";
import {
  runRuntimeAgent,
  type AgentRuntimeSettings,
  type ProviderSessionState,
} from "./runtimes/index.js";

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const ACTIVE_TTL_REFRESH_MS = 30 * 1000;

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
  cancelCurrentRun(reason?: string): boolean;
  resetTTL(): void;
  ttlRemainingMs(): number;
  destroy(): void;
}

function sameProviderSession(
  current: ProviderSessionState | null,
  next: ProviderSessionState | null,
): boolean {
  return Boolean(
    current?.runtimeId &&
      next?.runtimeId &&
      current.runtimeId === next.runtimeId &&
      current.sessionId &&
      current.sessionId === next.sessionId,
  );
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
  private activeAbortController: AbortController | null = null;

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
    this.activeAbortController = new AbortController();
    this.resetTTL();

    try {
      for await (const msg of runRuntimeAgent({
        prompt,
        config: this.config,
        settings,
        sessionState: this.sessionState,
        workerBaseUrl,
        signal: this.activeAbortController.signal,
      })) {
        if (this.activeAbortController.signal.aborted) {
          throw new Error("Agent run cancelled");
        }
        if (Date.now() - this.lastActiveAt.getTime() >= ACTIVE_TTL_REFRESH_MS) {
          this.resetTTL();
        }
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
      this.activeAbortController = null;
      this.status = "idle";
      this.lastActiveAt = new Date();
      this.resetTTL();
    }
  }

  cancelCurrentRun(reason = "cancelled"): boolean {
    if (this.status !== "busy" || !this.activeAbortController) return false;
    if (!this.activeAbortController.signal.aborted) {
      this.activeAbortController.abort(new Error(reason));
    }
    return true;
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
    this.cancelCurrentRun("session_destroyed");
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
        // A live worker session has the provider's latest on-disk/runtime
        // state. Do not overwrite it with an older app-persisted snapshot for
        // the same provider session, because that can undo native compaction.
        if (!sameProviderSession(existing.sessionState, resumeSessionState)) {
          existing.sessionState = resumeSessionState;
        }
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

  cancel(appId: string, reason?: string): boolean {
    return this.sessions.get(appId)?.cancelCurrentRun(reason) ?? false;
  }

  listAll(): { appId: string; status: SessionStatus; sessionState: ProviderSessionState | null }[] {
    return Array.from(this.sessions.entries()).map(([appId, s]) => ({
      appId,
      status: s.status,
      sessionState: s.sessionState,
    }));
  }
}
