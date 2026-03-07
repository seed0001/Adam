import { EventEmitter } from "node:events";

export type AgentEventType = "thought" | "tool-call" | "tool-result" | "status" | "error" | "memory" | "context";

export interface AgentEvent {
    sessionId: string;
    type: AgentEventType;
    message: string;
    data?: any;
    timestamp: Date;
}

class AgentEventBus extends EventEmitter {
    emitEvent(event: AgentEvent) {
        this.emit("event", event);
        this.emit(`session:${event.sessionId}`, event);
    }

    onEvent(handler: (event: AgentEvent) => void) {
        this.on("event", handler);
    }

    onSessionEvent(sessionId: string, handler: (event: AgentEvent) => void) {
        this.on(`session:${sessionId}`, handler);
    }

    offSessionEvent(sessionId: string, handler: (event: AgentEvent) => void) {
        this.off(`session:${sessionId}`, handler);
    }
}

export const agentEventBus = new AgentEventBus();
