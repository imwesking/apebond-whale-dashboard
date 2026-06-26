interface RefreshableAllTimeCache {
  refreshAllTimeCache(wait?: boolean): Promise<void>;
}

interface SchedulerLogger {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
}

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface AllTimeRefreshSchedulerOptions {
  timeZone?: string;
  hour?: number;
  minute?: number;
  now?: () => Date;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  logger?: SchedulerLogger;
}

export interface AllTimeRefreshScheduler {
  stop(): void;
  getNextRunAt(): Date | null;
}

const DEFAULT_TIME_ZONE = "Europe/Madrid";
const DEFAULT_HOUR = 4;
const DEFAULT_MINUTE = 0;
const MAX_TIMEOUT_MS = 2_147_483_647;

export function startAllTimeRefreshScheduler(
  service: RefreshableAllTimeCache,
  options: AllTimeRefreshSchedulerOptions = {}
): AllTimeRefreshScheduler {
  const timeZone = options.timeZone ?? process.env.ALL_TIME_REFRESH_TIME_ZONE ?? DEFAULT_TIME_ZONE;
  const hour = getScheduleNumber(options.hour ?? readEnvNumber("ALL_TIME_REFRESH_HOUR"), DEFAULT_HOUR, 0, 23);
  const minute = getScheduleNumber(options.minute ?? readEnvNumber("ALL_TIME_REFRESH_MINUTE"), DEFAULT_MINUTE, 0, 59);
  const now = options.now ?? (() => new Date());
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const logger = options.logger ?? console;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let nextRunAt: Date | null = null;

  const scheduleNext = () => {
    if (stopped) return;

    const currentTime = now();
    nextRunAt = getNextZonedDailyRun(currentTime, timeZone, hour, minute);
    const delayMs = Math.min(Math.max(nextRunAt.getTime() - currentTime.getTime(), 1_000), MAX_TIMEOUT_MS);
    logger.log(
      `Scheduled all-time cache refresh for ${nextRunAt.toISOString()} (${formatScheduleTime(hour, minute)} ${timeZone})`
    );
    timer = setTimeoutFn(runRefresh, delayMs);
  };

  const runRefresh = () => {
    timer = null;
    if (stopped) return;

    logger.log(`Starting scheduled all-time cache refresh (${formatScheduleTime(hour, minute)} ${timeZone})`);
    void service.refreshAllTimeCache(false).catch((error: unknown) => {
      logger.error("Scheduled all-time cache refresh failed", error);
    });
    scheduleNext();
  };

  scheduleNext();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeoutFn(timer);
      timer = null;
      nextRunAt = null;
    },
    getNextRunAt() {
      return nextRunAt ? new Date(nextRunAt) : null;
    }
  };
}

export function getNextZonedDailyRun(now: Date, timeZone: string, hour: number, minute = 0): Date {
  const currentParts = getZonedParts(now, timeZone);
  const todayRun = zonedLocalTimeToUtc(
    {
      year: currentParts.year,
      month: currentParts.month,
      day: currentParts.day,
      hour,
      minute,
      second: 0
    },
    timeZone
  );

  if (todayRun.getTime() > now.getTime()) {
    return todayRun;
  }

  const tomorrow = new Date(Date.UTC(currentParts.year, currentParts.month - 1, currentParts.day + 1, 12));
  return zonedLocalTimeToUtc(
    {
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour,
      minute,
      second: 0
    },
    timeZone
  );
}

function zonedLocalTimeToUtc(localTime: ZonedDateTimeParts, timeZone: string): Date {
  const expectedUtc = Date.UTC(
    localTime.year,
    localTime.month - 1,
    localTime.day,
    localTime.hour,
    localTime.minute,
    localTime.second
  );
  let utcGuess = expectedUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actualParts = getZonedParts(new Date(utcGuess), timeZone);
    const actualUtc = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      actualParts.second
    );
    const adjustment = expectedUtc - actualUtc;
    if (adjustment === 0) break;
    utcGuess += adjustment;
  }

  return new Date(utcGuess);
}

function getZonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second"))
  };
}

function readEnvNumber(name: string): number | undefined {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === "") return undefined;

  const value = Number(rawValue);
  return Number.isInteger(value) ? value : undefined;
}

function getScheduleNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  return value !== undefined && value >= min && value <= max ? value : fallback;
}

function formatScheduleTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
