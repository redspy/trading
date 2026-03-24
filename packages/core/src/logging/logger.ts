// ─────────────────────────────────────────────────────────────
// 구조화 로거 (JSON 출력)
// 모든 로그는 JSON 한 줄로 stdout에 출력된다.
// 운영 환경에서 fluentd/logstash 등으로 수집하기 위한 구조다.
// ─────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => write("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context)
};
