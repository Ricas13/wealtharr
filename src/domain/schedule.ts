const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function parseDate(date: string) {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error("INVALID_LOCAL_DATE");
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function isoFromUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsIso(date: string, months: number) {
  const { year, month, day } = parseDate(date);
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonthZero = ((zeroBased % 12) + 12) % 12;
  const targetMonth = targetMonthZero + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return [
    String(targetYear).padStart(4, "0"),
    String(targetMonth).padStart(2, "0"),
    String(targetDay).padStart(2, "0")
  ].join("-");
}

function moveDate(date: string, days: number) {
  const { year, month, day } = parseDate(date);
  return isoFromUtcDate(new Date(Date.UTC(year, month - 1, day + days)));
}

function weekday(date: string) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function rollBusinessDay(
  date: string,
  holidays: string[] = [],
  convention: "PREVIOUS" | "NEXT" = "PREVIOUS"
) {
  const holidaySet = new Set(holidays);
  let cursor = date;
  const step = convention === "PREVIOUS" ? -1 : 1;
  for (let i = 0; i < 14; i += 1) {
    const day = weekday(cursor);
    if (day !== 0 && day !== 6 && !holidaySet.has(cursor)) return cursor;
    cursor = moveDate(cursor, step);
  }
  throw new Error("BUSINESS_DAY_ROLL_EXHAUSTED");
}

function offsetMinutesAt(instant: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit"
  });
  const zoneName = formatter.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  if (!zoneName || zoneName === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(zoneName);
  if (!match) throw new Error("UNSUPPORTED_TIMEZONE_OFFSET");
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

export function zonedLocalDateTimeToUtc(date: string, localTime: string, timeZone: string) {
  const { year, month, day } = parseDate(date);
  const timeMatch = TIME_RE.exec(localTime);
  if (!timeMatch) throw new Error("INVALID_LOCAL_TIME");
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) throw new Error("INVALID_LOCAL_TIME");

  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = wallClockUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = offsetMinutesAt(new Date(candidate), timeZone);
    const adjusted = wallClockUtc - offset * 60_000;
    if (adjusted === candidate) break;
    candidate = adjusted;
  }
  return new Date(candidate);
}

export function localDateInZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day");
}

/**
 * Months between reviews. THRESHOLD_ONLY is due at every check (0 months): the engine then compares drift
 * with the configured threshold and holds when inside it. An unknown value fails closed rather than
 * silently becoming quarterly.
 */
export const REVIEW_FREQUENCY_MONTHS: Record<string, number> = {
  THRESHOLD_ONLY: 0,
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12
};

export function nextReviewDueAt(input: {
  lastReviewAt: Date;
  frequency: string;
  timeZone: string;
  cutoffLocal?: string;
  holidays?: string[];
  convention?: "PREVIOUS" | "NEXT";
}) {
  if (!Object.hasOwn(REVIEW_FREQUENCY_MONTHS, input.frequency)) throw new Error("UNSUPPORTED_REVIEW_FREQUENCY");
  const months = REVIEW_FREQUENCY_MONTHS[input.frequency];
  const lastLocalDate = localDateInZone(input.lastReviewAt, input.timeZone);
  const nominalDate = addMonthsIso(lastLocalDate, months);
  const businessDate = rollBusinessDay(
    nominalDate,
    input.holidays ?? [],
    input.convention ?? "PREVIOUS"
  );
  return zonedLocalDateTimeToUtc(
    businessDate,
    input.cutoffLocal ?? "16:00",
    input.timeZone
  );
}

/**
 * A fixed calendar-quarter policy, NOT 3 months after the customer's signup.
 * Roll each Mar/Jun/Sep/Dec month end according to the code-locked market
 * calendar; choose the first review cutoff strictly later than last review.
 * "Market holidays" must be source-verified before the strategy is published.
 */
export function nextCalendarQuarterDueAt(input:{
  lastReviewAt:Date;timeZone:string;cutoffLocal?:string;holidays?:string[];
  convention?:"PREVIOUS"|"NEXT";
}):Date{
  const last=localDateInZone(input.lastReviewAt,input.timeZone);
  const {year,month}=parseDate(last);
  for(let n=0;n<12;n++){
    const m=Math.ceil(month/3)*3+n*3;
    const y=year+Math.floor((m-1)/12);
    const q=((m-1)%12)+1;
    const nominal=[String(y),String(q).padStart(2,"0"),String(daysInMonth(y,q)).padStart(2,"0")].join("-");
    const date=rollBusinessDay(nominal,input.holidays??[],input.convention??"PREVIOUS");
    const instant=zonedLocalDateTimeToUtc(date,input.cutoffLocal??"16:00",input.timeZone);
    if(instant.getTime()>input.lastReviewAt.getTime())return instant;
  }
  throw new Error("CALENDAR_QUARTER_DATE_UNAVAILABLE");
}
