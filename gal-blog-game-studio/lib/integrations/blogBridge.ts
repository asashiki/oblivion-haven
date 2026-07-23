import type { BlogActionName, BlogBridgeConfig } from "../story/types";

export type BridgeRequest = {
  channel: string;
  source: "galgame";
  id: string;
  type: "request";
  payload: { action: BlogActionName | string; payload?: Record<string, unknown> };
};

export type BridgeReply = {
  channel: string;
  source: "gal-blog";
  replyTo: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export class BlogBridgeClient {
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private listener = (event: MessageEvent) => this.receive(event);

  constructor(private readonly config: BlogBridgeConfig) {
    if (typeof window !== "undefined") window.addEventListener("message", this.listener);
  }

  request(action: BlogActionName | string, payload?: Record<string, unknown>): Promise<unknown> {
    if (!this.config.enabled) return Promise.reject(new Error("Blog Bridge 未启用"));
    if (action !== "custom" && !this.config.capabilities.some((capability) => capability === action)) {
      return Promise.reject(new Error(`Blog Bridge 未声明动作能力：${action}`));
    }
    if (window.parent === window) return Promise.resolve({ status: "success", standalone: true });
    const id = `bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let referrerOrigin = "";
    try {
      referrerOrigin = document.referrer ? new URL(document.referrer).origin : "";
    } catch {
      referrerOrigin = "";
    }
    const targetOrigin = this.config.allowedOrigins.includes(referrerOrigin)
      ? referrerOrigin
      : this.config.allowedOrigins.length === 1 ? this.config.allowedOrigins[0] : "*";
    const message: BridgeRequest = { channel: this.config.channel, source: "galgame", id, type: "request", payload: { action, payload } };
    window.parent?.postMessage(message, targetOrigin);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Blog Bridge 请求超时"));
      }, this.config.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  private receive(event: MessageEvent): void {
    if (window.parent !== window && event.source !== window.parent) return;
    if (this.config.allowedOrigins.length && !this.config.allowedOrigins.includes(event.origin)) return;
    const reply = event.data as BridgeReply;
    if (!reply || reply.channel !== this.config.channel || reply.source !== "gal-blog" || !reply.replyTo) return;
    const pending = this.pending.get(reply.replyTo);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(reply.replyTo);
    if (reply.ok) pending.resolve(reply.payload);
    else pending.reject(new Error(reply.error || "Blog Bridge 请求失败"));
  }

  dispose(): void {
    if (typeof window !== "undefined") window.removeEventListener("message", this.listener);
    this.pending.forEach((item) => clearTimeout(item.timer));
    this.pending.clear();
  }
}
