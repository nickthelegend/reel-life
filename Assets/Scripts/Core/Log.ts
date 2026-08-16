/**
 * Tagged logging.
 *
 * Everything routes through here so the Logger panel in Lens Studio can be
 * filtered by "[ReelLife]", and so a failure inside an async generation job is
 * never swallowed silently.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minimumLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minimumLevel = level;
}

function emit(level: LogLevel, tag: string, message: string): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) {
    return;
  }
  print(`[ReelLife/${tag}] ${level.toUpperCase()}: ${message}`);
}

export class Log {
  constructor(private tag: string) {}

  debug(message: string): void {
    emit("debug", this.tag, message);
  }

  info(message: string): void {
    emit("info", this.tag, message);
  }

  warn(message: string): void {
    emit("warn", this.tag, message);
  }

  error(message: string, error?: unknown): void {
    const detail = error === undefined ? "" : ` :: ${describeError(error)}`;
    emit("error", this.tag, `${message}${detail}`);
  }
}

export function describeError(error: unknown): string {
  if (error === null || error === undefined) {
    return "unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  const anyError = error as { message?: string; stack?: string };
  if (anyError.message) {
    return anyError.message;
  }
  try {
    return JSON.stringify(error);
  } catch (e) {
    return "unserializable error";
  }
}
