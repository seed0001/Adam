export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  context: string | undefined;
  data: Record<string, unknown> | undefined;
  timestamp: Date;
};

type LogHandler = (entry: LogEntry) => void;

const handlers: LogHandler[] = [];
let minLevel: LogLevel = "info";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

export function addLogHandler(handler: LogHandler): void {
  handlers.push(handler);
}

function log(level: LogLevel, message: string, context?: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const entry: LogEntry = { level, message, context, data, timestamp: new Date() };

  if (handlers.length === 0) {
    const prefix = context ? `[${context}]` : "";
    const levelTag = `[${level.toUpperCase()}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    if (level === "error" || level === "warn") {
      console.warn(`${entry.timestamp.toISOString()} ${levelTag}${prefix} ${message}${dataStr}`);
    }
  }

  for (const handler of handlers) {
    handler(entry);
  }
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) =>
      log("debug", message, context, data),
    info: (message: string, data?: Record<string, unknown>) =>
      log("info", message, context, data),
    warn: (message: string, data?: Record<string, unknown>) =>
      log("warn", message, context, data),
    error: (message: string, data?: Record<string, unknown>) =>
      log("error", message, context, data),
  };
}

export type Logger = ReturnType<typeof createLogger>;
