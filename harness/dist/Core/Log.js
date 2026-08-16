/**
 * Tagged logging.
 *
 * Everything routes through here so the Logger panel in Lens Studio can be
 * filtered by "[ReelLife]", and so a failure inside an async generation job is
 * never swallowed silently.
 */
const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
let minimumLevel = "info";
export function setLogLevel(level) {
    minimumLevel = level;
}
function emit(level, tag, message) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) {
        return;
    }
    print(`[ReelLife/${tag}] ${level.toUpperCase()}: ${message}`);
}
export class Log {
    constructor(tag) {
        this.tag = tag;
    }
    debug(message) {
        emit("debug", this.tag, message);
    }
    info(message) {
        emit("info", this.tag, message);
    }
    warn(message) {
        emit("warn", this.tag, message);
    }
    error(message, error) {
        const detail = error === undefined ? "" : ` :: ${describeError(error)}`;
        emit("error", this.tag, `${message}${detail}`);
    }
}
export function describeError(error) {
    if (error === null || error === undefined) {
        return "unknown error";
    }
    if (typeof error === "string") {
        return error;
    }
    const anyError = error;
    if (anyError.message) {
        return anyError.message;
    }
    try {
        return JSON.stringify(error);
    }
    catch (e) {
        return "unserializable error";
    }
}
