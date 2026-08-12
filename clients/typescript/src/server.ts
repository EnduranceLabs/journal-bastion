import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Integration, ToolDefinition, ToolResult, Skill } from "./types.js";
import { BastionMessageSchema } from "./types.js";

export interface TokenValidationResult {
  organizationId: string;
  organizationName?: string;
}

export interface TraceContext {
  traceparent: string;
  tracestate?: string;
}

export interface BastionServerOptions {
  /**
   * Port to bind when using {@link BastionServer.start}.
   * Pass `0` to let the OS pick an available port.
   * Not used when feeding connections externally via {@link BastionServer.handleConnection}.
   */
  port?: number;
  validateToken: (token: string) => Promise<TokenValidationResult | null>;
  pingIntervalMs?: number;
  pullTimeoutMs?: number;
  /**
   * Optional hook to extract W3C trace context from the active span for
   * propagation to the bastion. Called when sending tool_call messages.
   * Return `null` when no active trace context is available.
   */
  getTraceContext?: () => TraceContext | null;
  /**
   * Called for bastion socket errors and unexpected connection-handler
   * failures. `bastion` is `null` if the failure happened before completing
   * the handshake. When not provided, diagnostics are dropped — the library
   * never logs on its own.
   */
  onSocketError?: (error: Error, bastion: ConnectedBastion | null) => void;
}

export interface ConnectedBastion {
  id: string;
  organizationId: string;
  protocolVersion: number;
  gatewayVersion: string;
  integrations: Integration[];
  mcpVersion: string | null;
  skillsVersion: string | null;
}

interface PendingCall {
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingPull {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BastionEntry {
  ws: WebSocket;
  bastion: ConnectedBastion;
  pending: Map<string, PendingCall>;
  pendingPulls: Map<string, PendingPull>;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

export class BastionServer {
  private wss: WebSocketServer | null = null;
  private bastions = new Map<string, BastionEntry>();
  private _port: number;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connCounter = 0;
  private reqCounter = 0;
  private pullCounter = 0;
  private pullTimeoutMs: number;

  constructor(private options: BastionServerOptions) {
    this._port = options.port ?? 0;
    this.pullTimeoutMs = options.pullTimeoutMs ?? 30_000;
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `ws://localhost:${this._port}`;
  }

  get connectedBastions(): ConnectedBastion[] {
    return Array.from(this.bastions.values()).map((g) => g.bastion);
  }

  get availableTools(): Array<{ integrationId: string; name: string; description: string }> {
    const tools: Array<{ integrationId: string; name: string; description: string }> = [];
    for (const { bastion } of this.bastions.values()) {
      for (const integration of bastion.integrations) {
        for (const tool of integration.tools) {
          tools.push({
            integrationId: integration.id,
            name: tool.name,
            description: tool.description,
          });
        }
      }
    }
    return tools;
  }

  onBastionConnected?: (bastion: ConnectedBastion) => void;
  onBastionUpdated?: (bastion: ConnectedBastion) => void;
  onBastionDisconnected?: (
    bastion: ConnectedBastion,
    closeCode?: number,
    closeReason?: string,
  ) => void;

  /**
   * Start a standalone WebSocket server on the configured port.
   *
   * If you want to manage the HTTP server yourself (e.g. Fastify, Express),
   * skip this method and instead call {@link startHeartbeat} then pass each
   * incoming WebSocket to {@link handleConnection}.
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wss = new WebSocketServer({ port: this._port }, () => {
        const addr = this.wss!.address();
        if (typeof addr === "object" && addr !== null) {
          this._port = addr.port;
        }
        resolve();
      });

      this.wss.on("connection", (ws) => this.handleConnection(ws));

      this.startHeartbeat();
    });
  }

  /**
   * Stop the standalone WebSocket server created by {@link start}.
   *
   * If you manage the HTTP server yourself, use {@link shutdown} instead.
   */
  async stop(): Promise<void> {
    this.shutdown();

    return new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
        this.wss = null;
      } else {
        resolve();
      }
    });
  }

  /**
   * Start the heartbeat ping timer.
   *
   * Called automatically by {@link start}. Call this manually when using
   * {@link handleConnection} directly with an external HTTP server.
   */
  startHeartbeat(): void {
    if (this.pingTimer) return;
    const interval = this.options.pingIntervalMs ?? 30_000;
    if (interval > 0) {
      this.pingTimer = setInterval(() => this.sendPings(), interval);
    }
  }

  /**
   * Clean up all bastion connections and timers.
   *
   * Use this instead of {@link stop} when you manage the HTTP server yourself
   * and don't need to close the internal WebSocketServer.
   */
  shutdown(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    for (const [connId, entry] of this.bastions.entries()) {
      if (entry.pongTimer) clearTimeout(entry.pongTimer);
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Server shutting down"));
      }
      for (const pull of entry.pendingPulls.values()) {
        clearTimeout(pull.timer);
        pull.reject(new Error("Server shutting down"));
      }
      // Remove before closing so the ws close handler doesn't double-fire
      this.bastions.delete(connId);
      this.onBastionDisconnected?.(entry.bastion);
      entry.ws.close();
    }
  }

  async callTool(
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 90_000
  ): Promise<ToolResult> {
    let targetEntry: BastionEntry | undefined;
    for (const entry of this.bastions.values()) {
      if (entry.bastion.integrations.some((i) => i.id === integrationId)) {
        targetEntry = entry;
        break;
      }
    }

    if (!targetEntry) {
      throw new Error(`No bastion has integration "${integrationId}"`);
    }

    return this.callToolOnEntry(targetEntry, integrationId, toolName, args, timeoutMs);
  }

  /** Check if any bastion is connected for the given organization. */
  hasBastionForOrg(organizationId: string): boolean {
    for (const { bastion } of this.bastions.values()) {
      if (bastion.organizationId === organizationId) return true;
    }
    return false;
  }

  /** Get all connected bastions for an organization. */
  getBastionsForOrg(organizationId: string): ConnectedBastion[] {
    const result: ConnectedBastion[] = [];
    for (const { bastion } of this.bastions.values()) {
      if (bastion.organizationId === organizationId) {
        result.push(bastion);
      }
    }
    return result;
  }

  /** Get deduplicated tools across all bastions for an organization. */
  getToolsForOrg(
    organizationId: string
  ): Array<{ integrationId: string; tool: ToolDefinition }> {
    const seen = new Set<string>();
    const tools: Array<{ integrationId: string; tool: ToolDefinition }> = [];
    for (const { bastion } of this.bastions.values()) {
      if (bastion.organizationId !== organizationId) continue;
      for (const integration of bastion.integrations) {
        for (const tool of integration.tools) {
          const key = `${integration.id}.${tool.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            tools.push({ integrationId: integration.id, tool });
          }
        }
      }
    }
    return tools;
  }

  /** Pull current versions from a bastion. */
  async getVersions(bastionId: string): Promise<{ mcpVersion: string | null; skillsVersion: string | null }> {
    const data = await this.sendPull(bastionId, "get_versions");
    return data as { mcpVersion: string | null; skillsVersion: string | null };
  }

  /** Pull tools from a bastion. */
  async getTools(bastionId: string): Promise<{ integrations: Integration[]; mcpVersion: string | null }> {
    const data = await this.sendPull(bastionId, "get_tools");
    return data as { integrations: Integration[]; mcpVersion: string | null };
  }

  /** Pull skills from a bastion. */
  async getSkills(bastionId: string): Promise<{ skills: Skill[]; skillsVersion: string | null }> {
    const data = await this.sendPull(bastionId, "get_skills");
    return data as { skills: Skill[]; skillsVersion: string | null };
  }

  /**
   * Call a tool on any bastion for the given organization that provides the
   * requested integration. Picks a random candidate for load balancing and
   * retries on a different one if the call fails with a connection error.
   */
  async callToolForOrg(
    organizationId: string,
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = 90_000
  ): Promise<ToolResult> {
    const candidates: BastionEntry[] = [];
    for (const entry of this.bastions.values()) {
      if (
        entry.bastion.organizationId === organizationId &&
        entry.bastion.integrations.some((i) => i.id === integrationId)
      ) {
        candidates.push(entry);
      }
    }

    if (candidates.length === 0) {
      throw new Error(
        `No bastion for org "${organizationId}" has integration "${integrationId}"`
      );
    }

    // Shuffle candidates for load balancing
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    let lastError: Error | undefined;
    for (const entry of candidates) {
      try {
        return await this.callToolOnEntry(
          entry,
          integrationId,
          toolName,
          args,
          timeoutMs
        );
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on connection-level errors
        if (!lastError.message.includes("Bastion disconnected")) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("All bastion candidates failed");
  }

  private callToolOnEntry(
    entry: BastionEntry,
    integrationId: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<ToolResult> {
    const requestId = `req_${++this.reqCounter}`;

    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(requestId);
        reject(new Error(`Tool call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      entry.pending.set(requestId, { resolve, reject, timer });

      const traceCtx = this.options.getTraceContext?.() ?? null;
      entry.ws.send(
        JSON.stringify({
          type: "tool_call",
          requestId,
          integrationId,
          toolName,
          arguments: args,
          ...(traceCtx?.traceparent
            ? { traceparent: traceCtx.traceparent }
            : {}),
          ...(traceCtx?.tracestate
            ? { tracestate: traceCtx.tracestate }
            : {}),
        })
      );
    });
  }

  private sendPull(bastionId: string, type: string): Promise<unknown> {
    const entry = this.bastions.get(bastionId);
    if (!entry) {
      return Promise.reject(new Error(`Bastion "${bastionId}" not found`));
    }

    const requestId = `pull_${++this.pullCounter}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pendingPulls.delete(requestId);
        reject(new Error(`Pull ${type} timed out`));
      }, this.pullTimeoutMs);

      entry.pendingPulls.set(requestId, { resolve, reject, timer });

      entry.ws.send(JSON.stringify({ type, requestId }));
    });
  }

  private resolvePull(connId: string, requestId: string, data: unknown): void {
    const entry = this.bastions.get(connId);
    if (!entry) return;
    const pull = entry.pendingPulls.get(requestId);
    if (pull) {
      clearTimeout(pull.timer);
      entry.pendingPulls.delete(requestId);
      pull.resolve(data);
    }
  }

  private reportSocketError(error: unknown, bastion: ConnectedBastion | null): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    try {
      this.options.onSocketError?.(normalized, bastion);
    } catch {
      // Diagnostic callbacks are user code; never let them crash the host.
    }
  }

  private async autoPull(connId: string): Promise<void> {
    const entry = this.bastions.get(connId);
    if (!entry) return;

    const pulls: Promise<void>[] = [];

    if (entry.bastion.mcpVersion !== null) {
      pulls.push(this.pullTools(connId));
    }
    if (entry.bastion.skillsVersion !== null) {
      pulls.push(this.pullSkills(connId));
    }

    await Promise.all(pulls);
  }

  private async pullTools(connId: string): Promise<void> {
    const entry = this.bastions.get(connId);
    if (!entry) return;

    const data = await this.sendPull(connId, "get_tools") as {
      integrations: Integration[];
      mcpVersion: string | null;
    };

    entry.bastion.integrations = [
      ...data.integrations,
      ...entry.bastion.integrations.filter((i) => i.id === "skills"),
    ];
    entry.bastion.mcpVersion = data.mcpVersion;
  }

  private async pullSkills(connId: string): Promise<void> {
    const entry = this.bastions.get(connId);
    if (!entry) return;

    const data = await this.sendPull(connId, "get_skills") as {
      skills: Skill[];
      skillsVersion: string | null;
    };

    // Build skills integration if any skills exist
    const nonSkillIntegrations = entry.bastion.integrations.filter((i) => i.id !== "skills");
    if (data.skills.length > 0) {
      nonSkillIntegrations.push({
        id: "skills",
        name: "Skills",
        description: "Bastion skills",
        tools: [],
        skills: data.skills,
      });
    }
    entry.bastion.integrations = nonSkillIntegrations;
    entry.bastion.skillsVersion = data.skillsVersion;
  }

  /**
   * Handle a new bastion WebSocket connection.
   *
   * Called automatically for connections received by the internal
   * WebSocketServer when using {@link start}. Call this manually to feed
   * connections from an external HTTP server (e.g. a Fastify websocket route).
   */
  handleConnection(ws: WebSocket): void {
    const connId = `gw_${++this.connCounter}`;
    let authenticated = false;
    let organizationId = "";
    let protocolVersion = 0;
    let gatewayVersion = "unknown";

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.close();
      }
    }, 10_000);

    const handleMessage = async (data: RawData): Promise<void> => {
      let msg;
      try {
        msg = BastionMessageSchema.parse(JSON.parse(data.toString()));
      } catch {
        return;
      }

      switch (msg.type) {
        case "authenticate": {
          const result = await this.options.validateToken(msg.token);
          if (result) {
            clearTimeout(authTimer);
            authenticated = true;
            organizationId = result.organizationId;
            protocolVersion = msg.protocolVersion;
            gatewayVersion = msg.gatewayVersion;
            ws.send(
              JSON.stringify({
                type: "authenticated",
                organizationId: result.organizationId,
                ...(result.organizationName
                  ? { organizationName: result.organizationName }
                  : {}),
              })
            );
          } else {
            clearTimeout(authTimer);
            ws.send(
              JSON.stringify({
                type: "auth_error",
                error: "Invalid token",
              })
            );
            ws.close();
          }
          break;
        }

        case "version_changed": {
          if (!authenticated) {
            ws.close();
            return;
          }

          const mcpVersion = msg.mcpVersion;
          const skillsVersion = msg.skillsVersion;

          const existing = this.bastions.get(connId);
          if (existing) {
            // Subsequent version_changed: update versions and pull what changed
            const mcpChanged = mcpVersion !== existing.bastion.mcpVersion;
            const skillsChanged = skillsVersion !== existing.bastion.skillsVersion;

            existing.bastion.mcpVersion = mcpVersion;
            existing.bastion.skillsVersion = skillsVersion;

            const pulls: Promise<void>[] = [];
            if (mcpChanged && mcpVersion !== null) {
              pulls.push(this.pullTools(connId));
            } else if (mcpChanged && mcpVersion === null) {
              // MCP removed: clear tool integrations
              existing.bastion.integrations = existing.bastion.integrations.filter(
                (i) => i.id === "skills"
              );
            }
            if (skillsChanged && skillsVersion !== null) {
              pulls.push(this.pullSkills(connId));
            } else if (skillsChanged && skillsVersion === null) {
              // Skills removed: clear skills integrations
              existing.bastion.integrations = existing.bastion.integrations.filter(
                (i) => i.id !== "skills"
              );
            }

            if (pulls.length > 0) {
              await Promise.all(pulls);
            }
            this.onBastionUpdated?.(existing.bastion);
          } else {
            // First version_changed: create bastion entry, auto-pull, then fire connected
            const bastion: ConnectedBastion = {
              id: connId,
              organizationId,
              protocolVersion,
              gatewayVersion,
              integrations: [],
              mcpVersion,
              skillsVersion,
            };

            const entry: BastionEntry = {
              ws,
              bastion,
              pending: new Map(),
              pendingPulls: new Map(),
              pongTimer: null,
            };

            this.bastions.set(connId, entry);

            await this.autoPull(connId);
            this.onBastionConnected?.(bastion);
          }
          break;
        }

        case "tool_result": {
          const entry = this.bastions.get(connId);
          if (!entry) return;
          const pending = entry.pending.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            entry.pending.delete(msg.requestId);
            pending.resolve(msg.result);
          }
          break;
        }

        case "tool_error": {
          const entry = this.bastions.get(connId);
          if (!entry) return;
          const pending = entry.pending.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            entry.pending.delete(msg.requestId);
            pending.reject(
              new Error(
                `Tool error [${msg.error.code}]: ${msg.error.message}`
              )
            );
          }
          break;
        }

        case "pong": {
          const entry = this.bastions.get(connId);
          if (entry?.pongTimer) {
            clearTimeout(entry.pongTimer);
            entry.pongTimer = null;
          }
          break;
        }

        case "versions": {
          this.resolvePull(connId, msg.requestId, {
            mcpVersion: msg.mcpVersion,
            skillsVersion: msg.skillsVersion,
          });
          break;
        }

        case "tools": {
          this.resolvePull(connId, msg.requestId, {
            integrations: msg.integrations,
            mcpVersion: msg.mcpVersion,
          });
          break;
        }

        case "skills": {
          this.resolvePull(connId, msg.requestId, {
            skills: msg.skills,
            skillsVersion: msg.skillsVersion,
          });
          break;
        }
      }
    };

    ws.on("message", (data) => {
      void handleMessage(data).catch((err) => {
        this.reportSocketError(err, this.bastions.get(connId)?.bastion ?? null);
        ws.close();
      });
    });

    // An "error" event with no listener crashes the host process.
    ws.on("error", (err: Error) => {
      this.reportSocketError(err, this.bastions.get(connId)?.bastion ?? null);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      clearTimeout(authTimer);
      const entry = this.bastions.get(connId);
      if (entry) {
        if (entry.pongTimer) clearTimeout(entry.pongTimer);
        for (const pending of entry.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Bastion disconnected"));
        }
        for (const pull of entry.pendingPulls.values()) {
          clearTimeout(pull.timer);
          pull.reject(new Error("Bastion disconnected"));
        }
        this.bastions.delete(connId);
        const reasonStr = reason?.toString() || undefined;
        this.onBastionDisconnected?.(entry.bastion, code, reasonStr);
      }
    });
  }

  private sendPings(): void {
    for (const entry of this.bastions.values()) {
      entry.ws.send(JSON.stringify({ type: "ping" }));
      if (entry.pongTimer) clearTimeout(entry.pongTimer);
      entry.pongTimer = setTimeout(() => {
        entry.ws.close();
      }, 10_000);
    }
  }
}
