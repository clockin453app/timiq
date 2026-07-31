/**
 * Authoritative “hours worked today” for the post–clock-out summary.
 * Uses the same company time-policy timezone as Time Records / timesheets.
 */

import { listMyTimeRecords } from "@/features/time-records/api";
import { fetchMyTimesheetWeek } from "@/features/timesheets/api";
import {
  browserDefaultTimeZone,
  mondayWeekStartIso,
} from "@/features/timesheets/week-utils";
import {
  resolveAuthoritativeCompanyTimeZone,
  sumTodayWorkedSeconds,
  timeRecordsDayBoundsForNow,
} from "./clock-out-summary";

/**
 * Resolve company timezone once (timesheet week metadata), then load completed
 * Time Records for that company-local calendar day. Returns null on any failure
 * so the UI can redirect without inventing a total.
 */
export async function fetchAuthoritativeTodayWorkedSeconds(
  now: Date = new Date(),
): Promise<number | null> {
  try {
    const hintTz = browserDefaultTimeZone();
    const week = await fetchMyTimesheetWeek(mondayWeekStartIso(now, hintTz));
    const companyTimeZone = resolveAuthoritativeCompanyTimeZone(week.company_timezone);
    if (!companyTimeZone) {
      return null;
    }
    const bounds = timeRecordsDayBoundsForNow(now, companyTimeZone);
    if (!bounds) {
      return null;
    }
    const rows = await listMyTimeRecords({
      start_date: bounds.startDate,
      end_date: bounds.endDateExclusive,
      status: "completed",
      limit: 50,
    });
    return sumTodayWorkedSeconds(rows);
  } catch {
    return null;
  }
}
