import pino, { LoggerOptions } from "pino";

/**
 * Creates a configured pino logger instance.
 * By default, it uses 'pino-pretty' if it's available and not in a production-like environment,
 * ensuring human-readable logs during development.
 */
export const createKNXLogger = (options?: LoggerOptions) => {
  const defaultOptions: LoggerOptions = {
    level: options?.level || "info",
    // Base formatting: human-readable for most use cases if no custom transport is provided
    transport: options?.transport || {
      target: "pino-pretty",
      options: {
        colorize: true,
        messageFormat: "[{module}] {msg}",
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname,module",
        customColors: "info:blue,warn:yellow,error:red,debug:orange"
      },
    },
    ...options,
  };

  return pino(defaultOptions);
};

// Global default logger (initially with default info level)
export const knxLogger = createKNXLogger();
