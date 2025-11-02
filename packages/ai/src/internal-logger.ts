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
 * Check if logging is currently enabled.
 * @returns true if logging is enabled, false otherwise
 */
export function isLoggingEnabled(): boolean {
  return enabled;
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
