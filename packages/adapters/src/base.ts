import { EventEmitter } from "node:events";
import type { InboundMessage, OutboundMessage, MessageSource } from "@adam/shared";

export type AdapterEvent = {
  message: [InboundMessage];
};

/**
 * Base adapter interface. Each messaging platform adapter extends this.
 * Adapters communicate with the daemon via typed EventEmitter — if one
 * adapter crashes, the daemon is unaffected.
 */
export abstract class BaseAdapter extends EventEmitter<AdapterEvent> {
  abstract readonly source: MessageSource;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(message: OutboundMessage): Promise<void>;
  abstract isConnected(): boolean;
}
