import type { SDKMessage } from "./runner.js";

const encoder = new TextEncoder();

export function encodeSSE(data: string): Uint8Array {
  return encoder.encode(`data: ${data}\n\n`);
}

export function encodeDone(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

export function encodeError(error: string): Uint8Array {
  return encodeSSE(JSON.stringify({ type: "error", error }));
}

export function encodeMessage(msg: SDKMessage): Uint8Array {
  return encodeSSE(JSON.stringify(msg));
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const;
