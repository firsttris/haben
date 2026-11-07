import type { OwnInvoiceSignal, SignalDirection } from "./types.ts";

export function signal(rule: string, direction: SignalDirection, confidence: number, reason: string): OwnInvoiceSignal {
  return { rule, direction, confidence, reason };
}
