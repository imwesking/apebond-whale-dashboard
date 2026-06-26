import { describe, expect, it } from "vitest";
import { getNextZonedDailyRun } from "../server/allTimeRefreshScheduler";

describe("all-time refresh scheduler", () => {
  it("schedules 04:00 Europe/Madrid during summer time", () => {
    const nextRun = getNextZonedDailyRun(new Date("2026-06-16T01:30:00.000Z"), "Europe/Madrid", 4);

    expect(nextRun.toISOString()).toBe("2026-06-16T02:00:00.000Z");
  });

  it("rolls to the next day after the Madrid run has passed", () => {
    const nextRun = getNextZonedDailyRun(new Date("2026-06-16T02:05:00.000Z"), "Europe/Madrid", 4);

    expect(nextRun.toISOString()).toBe("2026-06-17T02:00:00.000Z");
  });

  it("schedules 04:00 Europe/Madrid during winter time", () => {
    const nextRun = getNextZonedDailyRun(new Date("2026-01-10T02:30:00.000Z"), "Europe/Madrid", 4);

    expect(nextRun.toISOString()).toBe("2026-01-10T03:00:00.000Z");
  });
});
