/**
 * Internal logging utility for tool2agent.
 * Logging can be controlled globally via the enabled flag.
 */
let enabled = false;

/**
 * Enable or disable internal logging.
 * @param value - Whether to enable logging (default: true)
 */
export function setLoggingEnabled(value: boolean = true): void {
  enabled = value;
}

/**
 * Log a message if logging is enabled.
 * @param args - Arguments to pass to console.log
 */
export function log(...args: unknown[]): void {
  if (enabled) {
    console.log(...args);
  }
}

/**
 * Log a message with delayed computation. The callback is only executed if logging is enabled.
 * This is useful for avoiding expensive operations (like JSON.stringify) when logging is disabled.
 * @param callback - A function that returns the arguments to pass to console.log
 */
export function delayedLog(callback: () => unknown[]): void {
  if (enabled) {
    console.log(...callback());
  }
}
