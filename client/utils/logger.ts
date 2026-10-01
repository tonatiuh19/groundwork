type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, scope: string, ...args: unknown[]) {
  const prefix = `[groundwork:${scope}]`;
  // eslint-disable-next-line no-console
  console[level](prefix, ...args);
}

export const logger = {
  debug: (scope: string, ...args: unknown[]) => log("debug", scope, ...args),
  info: (scope: string, ...args: unknown[]) => log("info", scope, ...args),
  warn: (scope: string, ...args: unknown[]) => log("warn", scope, ...args),
  error: (scope: string, ...args: unknown[]) => log("error", scope, ...args),
};
