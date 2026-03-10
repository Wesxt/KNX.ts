import pino, { Logger, TransportMultiOptions } from "pino";
import { isColorSupported } from "colorette";
import path from "path";
import fs from "fs";
import { KNXLoggerOptions } from "../@types/interfaces/connection";

/**
 * Creates a configured pino logger instance.
 * Completely configurable via options, no environment variable dependencies.
 * Production mode (JSON) is only active if NOT in a test environment.
 */
export const createKNXLogger = (options?: KNXLoggerOptions): Logger => {
  const isProduction = process.env.NODE_ENV === "production";

  const targets: any[] = [];

  // 1. Console Transport
  if (!isProduction) {
    targets.push({
      target: "pino-pretty",
      options: {
        colorize: isColorSupported,
        messageFormat: "[{module}] {msg}",
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname,module",
        customColors: "info:blue,warn:yellow,error:red,debug:magenta",
      },
    });
  } else if (options?.logToFile) {
    // In production with file logging, we must explicitly add stdout if we want it
    targets.push({
      target: "pino/file",
      options: { destination: 1 }, // 1 = stdout
    });
  }

  // 2. File Transport (pino-roll)
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

    targets.push({
      target: "pino-roll",
      options: {
        file: path.join(logDir, logFile),
        size: options.logSize || "10M",
        interval: options.logInterval || "1d",
        limit: {
          count: options.logKeepCount || 7,
        },
        mkdir: true,
      },
    });
  }

  const transportConfig = targets.length > 0
    ? { targets } as TransportMultiOptions
    : undefined;

  const defaultOptions: any = {
    level: options?.level || "info",
    timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
    enabled: options?.enabled ?? true,
    transport: options?.transport || transportConfig,
    ...options,
  };

  // Pino does not allow custom level formatters when using transports with targets
  if (!defaultOptions.transport) {
    defaultOptions.formatters = {
      level: (label: string) => ({ level: label }),
      ...options?.formatters,
    };
  }

  return pino(defaultOptions);
};

/**
 * Global default logger instance.
 */
export let knxLogger: Logger = createKNXLogger();

/**
 * Configures the global knxLogger instance.
 * Call this at the beginning of your application to apply custom settings.
 */
export const setupLogger = (options: KNXLoggerOptions): Logger => {
  knxLogger = createKNXLogger(options);
  return knxLogger;
};
