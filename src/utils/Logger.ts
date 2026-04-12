import pino from "pino";
import path from "path";
import fs from "fs";
import { KNXLoggerOptions } from "../@types/interfaces/connection";

/**
 * Creates a configured pino logger instance.
 * Completely configurable via options, no environment variable dependencies.
 * Logs asynchronously to prevent blocking the event loop.
 */
export const createKNXLogger = (options?: KNXLoggerOptions): pino.Logger => {
  const defaultOptions: any = {
    level: options?.level || "info",
    timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    enabled: options?.enabled ?? true,
    ...options,
  };

  if (!defaultOptions.formatters) {
    defaultOptions.formatters = {
      level: (label: string) => ({ level: label }),
      ...options?.formatters,
    };
  }

  const streams: pino.StreamEntry[] = [];

  // Default stdout stream (asynchronous)
  streams.push({
    level: defaultOptions.level,
    stream: pino.destination({ dest: 1, sync: false }),
  });

  // File logging (asynchronous)
  if (options?.logToFile) {
    const logDir = options.logDir || "./logs";
    let logFile = options.logFilename;

    if (!logFile || logFile.trim() === "") {
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
      logFile = `${dateStr}.log`;
    }

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    streams.push({
      level: defaultOptions.level,
      stream: pino.destination({
        dest: path.join(logDir, logFile),
        sync: false,
      }),
    });
  }

  return pino(defaultOptions, pino.multistream(streams));
};

/**
 * Global default logger instance.
 */
export let knxLogger: pino.Logger = createKNXLogger();

/**
 * Configures the global knxLogger instance.
 * Call this at the beginning of your application to apply custom settings.
 */
export const setupLogger = (options: KNXLoggerOptions): pino.Logger => {
  knxLogger = createKNXLogger(options);
  return knxLogger;
};
