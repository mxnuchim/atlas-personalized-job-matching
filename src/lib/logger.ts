import pino, { type Logger } from "pino";

import { env, isDevelopment } from "./env";

/**
 * Structured logging (PRD §12). Pretty output in dev, JSON in prod. Kept external
 * from the server bundle via `serverExternalPackages` in next.config.ts.
 */
function createLogger(): Logger {
  // env.LOG_LEVEL is validated with a default of "info", but stay resilient when
  // env validation is skipped (e.g. `SKIP_ENV_VALIDATION` in CI builds).
  const level = env.LOG_LEVEL ?? "info";

  if (isDevelopment) {
    return pino({
      level,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    });
  }
  return pino({ level });
}

export const logger = createLogger();

/** Child logger tagged with a subsystem name, e.g. `log("pipeline")`. */
export function log(scope: string): Logger {
  return logger.child({ scope });
}
