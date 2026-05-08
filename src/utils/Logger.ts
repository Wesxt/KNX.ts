import { isMainThread, parentPort, Worker } from "worker_threads";
import fs from "fs";
import path from "path";
import { KNXLoggerOptions } from "../@types/interfaces/connection";

export type LogLevel = "debug" | "info" | "warn" | "error" | "noLog";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  noLog: 99,
};

const COLORS = {
  reset: "\x1b[0m",
  debug: "\x1b[36m", // Cyan
  info: "\x1b[32m", // Green
  warn: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
};

// ============================================
// WORKER THREAD LOGIC
// ============================================
if (!isMainThread && parentPort) {
  let currentLogFile = "";
  let logStream: fs.WriteStream | null = null;

  parentPort.on("message", (msg) => {
    if (msg.type === "log" && msg.logDir) {
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
      const filenameStr = msg.logFilename ? `${dateStr}-${msg.logFilename}` : `${dateStr}.log`;
      const expectedFile = path.join(msg.logDir, filenameStr);

      if (currentLogFile !== expectedFile) {
        if (logStream) logStream.close();
        if (!fs.existsSync(msg.logDir)) {
          fs.mkdirSync(msg.logDir, { recursive: true });
        }
        currentLogFile = expectedFile;
        logStream = fs.createWriteStream(currentLogFile, { flags: "a" });
      }

      if (logStream) {
        // Strip ANSI codes before writing to file
        // eslint-disable-next-line no-control-regex
        const cleanMsg = msg.payload.replace(/\x1b\[[0-9;]*m/g, "");
        logStream.write(cleanMsg + "\n");
      }
    } else if (msg.type === "close") {
      if (logStream) logStream.close();
      process.exit(0);
    }
  });
}

// ============================================
// MAIN THREAD LOGIC
// ============================================

export class Logger {
  private options: KNXLoggerOptions;
  public moduleName: string;
  private static workerInstance: Worker | null = null;

  constructor(options?: KNXLoggerOptions, moduleName = "KNX") {
    this.options = {
      level: "info",
      enabled: true,
      logToFile: false,
      logDir: "./logs",
      logFilename: "",
      ...options,
    };
    this.moduleName = moduleName;

    if (isMainThread && this.options.logToFile && !Logger.workerInstance) {
      this.initWorker();
    }
  }

  private initWorker() {
    const workerFile = __filename;
    Logger.workerInstance = new Worker(workerFile, {
      execArgv: workerFile.endsWith(".ts") ? ["--require", "tsx"] : undefined,
    });

    Logger.workerInstance.unref();
  }

  public get level(): LogLevel {
    return (this.options.level as LogLevel) || "info";
  }

  public set level(level: LogLevel) {
    this.options.level = level;
  }

  /**
   * Clone the logger and attach a specific module string.
   */
  public module(moduleName: string): Logger {
    return new Logger(this.options, moduleName);
  }

  /**
   * Similar to pino's child() usage in the legacy code.
   */
  public child(bindings: { module?: string; component?: string; [key: string]: any }): Logger {
    return this.module(bindings.module || bindings.component || this.moduleName);
  }

  private shouldLog(msgLevel: LogLevel): boolean {
    if (!this.options.enabled || this.level === "noLog" || msgLevel === "noLog") return false;
    return LEVELS[msgLevel] >= LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, ...args: any[]): { colored: string; raw: string } {
    const nowISO = new Date().toISOString();
    const joinedArgs = args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");

    const color = COLORS[level as keyof typeof COLORS] || COLORS.reset;
    const prefixCol = `${color}${nowISO} [${this.moduleName}] [${level.toUpperCase()}]${COLORS.reset}`;

    const colored = `${prefixCol} ${joinedArgs}`;
    return { colored, raw: colored }; // Worker handles ANSI stripping
  }

  private dispatch(level: LogLevel, ...args: any[]) {
    if (!this.shouldLog(level)) return;

    const { colored, raw } = this.formatMessage(level, ...args);

    // 1. Console Log
    switch (level) {
      case "error":
        console.error(colored);
        break;
      case "warn":
        console.warn(colored);
        break;
      case "debug":
        console.debug(colored);
        break;
      default:
        console.log(colored);
        break;
    }

    // 2. File Log via Worker
    if (this.options.logToFile && Logger.workerInstance) {
      Logger.workerInstance.postMessage({
        type: "log",
        payload: raw,
        logDir: this.options.logDir,
        logFilename: this.options.logFilename,
      });
    }
  }

  public debug(...args: any[]) {
    this.dispatch("debug", ...args);
  }
  public info(...args: any[]) {
    this.dispatch("info", ...args);
  }
  public warn(...args: any[]) {
    this.dispatch("warn", ...args);
  }
  public error(...args: any[]) {
    this.dispatch("error", ...args);
  }
  // Allow fatal identical to error (pino legacy fallback)
  public fatal(...args: any[]) {
    this.dispatch("error", ...args);
  }
  public trace(...args: any[]) {
    this.dispatch("debug", ...args);
  }

  public updateOptions(options: Partial<KNXLoggerOptions>) {
    this.options = { ...this.options, ...options };
    if (isMainThread && this.options.logToFile && !Logger.workerInstance) {
      this.initWorker();
    }
  }
}

/**
 * Creates a locally scoped logger instance.
 */
export const createKNXLogger = (options?: KNXLoggerOptions): Logger => {
  return new Logger(options);
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
  knxLogger.updateOptions(options);
  // Also recreate if needed, but updating is safer if references exist
  // We recreate here to ensure options are perfectly mapped.
  knxLogger = createKNXLogger(options);
  return knxLogger;
};
