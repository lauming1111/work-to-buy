import {
  CppYtd,
  EiYtd,
  computeCpp,
  computeEi,
  computeIncomeTax,
  getTaxYearRates,
} from "./tax";

/* ---------------------- Types ---------------------- */
export type Item = {
  id: number;
  name: string;
  price: number;
  taxable: boolean;
  enabled: boolean;
};

export type JobMeta = {
  id: string;
  name: string;
};

export type DayHours = {
  date: string; // "YYYY-MM-DD"
  start?: string | null; // "HH:MM"
  end?: string | null;   // "HH:MM"
  hours?: number | null; // calculated, not user input
  lunch?: boolean;       // legacy lunch toggle state
  lunchMinutes?: number | null; // minutes to subtract when lunch is enabled
  originalHours?: number | null;
};

export type DetailedDay = {
  date: string;
  hours: number;
  earnings: number; // gross
  incomeTax: number;
  employeeInsurance: number;
  cpp: number;
  afterTax: number;
};

export type PaymentCycle = "biweekly" | "semi-monthly" | "monthly";

export type RosterData = {
  weekly: Record<string, string>;
  monthly: Record<string, string>;
};

export type JobExport = {
  items: Item[];
  hourlyRate: number;
  dayHours: DayHours[];
  startDate: string;
  currentDate?: string;
  payCycle?: PaymentCycle;
  roster?: RosterData;
};

export type AllJobsExport = {
  type: "w2b_all_jobs";
  version: 1;
  activeJobId: string;
  jobs: JobMeta[];
  jobData: Record<string, JobExport>;
};

export type NormalizedJobData = {
  items: Item[];
  hourlyRate: number;
  dayHours: DayHours[];
  startDate: string;
  currentDate: Date;
  payCycle: PaymentCycle;
  roster: RosterData;
};

/** One job's inputs, everything needed to price its hours on its own rate. */
export type JobCalcInput = {
  id: string;
  name: string;
  hourlyRate: number;
  startDate: string;
  dayHours: DayHours[];
  payCycle?: PaymentCycle;
};

/** One job's computed earnings, priced with that job's own hourly rate. */
export type JobEarnings = {
  id: string;
  name: string;
  hourlyRate: number;
  hours: number;
  gross: number;
  afterTax: number;
};

export type AllJobsSummary = {
  jobs: JobEarnings[];
  totalHours: number;
  totalGross: number;
  totalAfterTax: number;
};

/* -------------------- Constants -------------------- */
export const BIWEEKLY_TAXFREE_THRESHOLD = 88;
export const BIWEEKLY_BONUS_RATE = 0.04; // 4% vacation pay per cycle
export const WEEKLY_OVERTIME_THRESHOLD = 44;
export const OVERTIME_MULTIPLIER = 1.5;
export const DEFAULT_LUNCH_MINUTES = 30;

export const UNLAWFUL_RULE_JOB_NAME = "3495";

export const defaultItems: Item[] = [
  { id: 1, name: "Rent", price: 0, taxable: false, enabled: true },
  { id: 2, name: "Food / Groceries", price: 0, taxable: true, enabled: true },
  { id: 3, name: "Transportation", price: 0, taxable: true, enabled: true },
];

/* -------------------- Helpers -------------------- */
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export const parseYmdLocal = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export function getTorontoToday(): Date {
  const now = new Date();
  const torontoParts = now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).split("-");
  return new Date(`${torontoParts[0]}-${torontoParts[1]}-${torontoParts[2]}T00:00:00-04:00`);
}

export const clampLunchMinutes = (value?: number | null) => {
  if (value == null) return DEFAULT_LUNCH_MINUTES;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LUNCH_MINUTES;
  return Math.max(0, Math.min(180, Math.round(n)));
};

export const getLunchMinutes = (entry?: DayHours | null) => {
  if (!entry) return 0;
  if (entry.lunchMinutes != null) return clampLunchMinutes(entry.lunchMinutes);
  if (entry.lunch === false) return 0;
  return DEFAULT_LUNCH_MINUTES;
};

export const getOriginalHours = (entry: DayHours) => {
  if (entry.originalHours != null) return entry.originalHours;
  if (entry.hours != null && !entry.start && !entry.end) return entry.hours;
  return null;
};

const utcDayStart = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/** Week / bi-week buckets are counted from the job's own start date, not the calendar. */
export const getIndexInfo = (dateStr: string, baseStart: string) => {
  const start = parseYmdLocal(baseStart);
  const dt = parseYmdLocal(dateStr);
  // Count whole calendar days. Subtracting timestamps would be an hour short
  // across a daylight-saving change and shift every later date into the wrong
  // week and pay period.
  const diffDays = Math.round((utcDayStart(dt) - utcDayStart(start)) / (1000 * 3600 * 24));
  return {
    diffDays,
    weekIndex: Math.floor(diffDays / 7),
    biWeekIndex: Math.floor(diffDays / 14),
  };
};

/** The "unlawful" payroll rule is opted into by naming the job exactly "3495". */
export const isUnlawfulRuleJob = (jobName?: string | null) =>
  (jobName ?? "").trim() === UNLAWFUL_RULE_JOB_NAME;

/* ------------- Pay periods ------------- */

export const PERIODS_PER_YEAR: Record<PaymentCycle, number> = {
  biweekly: 26,
  "semi-monthly": 24,
  monthly: 12,
};

export const DEFAULT_CALC_PAY_CYCLE: PaymentCycle = "biweekly";

const lastDayOfMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/**
 * Which pay period a date falls in, and when that period ends.
 *
 * Bi-weekly periods are counted from the job's own start date; semi-monthly and
 * monthly ones follow the calendar. The end date is what picks the tax year for
 * the period, matching CRA's use of the payment date.
 */
export function getPeriodInfo(dateStr: string, payCycle: PaymentCycle, baseStart: string) {
  const d = parseYmdLocal(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();

  if (payCycle === "monthly") {
    const endDay = lastDayOfMonth(year, month);
    return { key: `m:${year}-${month}`, end: new Date(year, month, endDay) };
  }

  if (payCycle === "semi-monthly") {
    const firstHalf = d.getDate() <= 15;
    const endDay = firstHalf ? 15 : lastDayOfMonth(year, month);
    return { key: `sm:${year}-${month}-${firstHalf ? 1 : 2}`, end: new Date(year, month, endDay) };
  }

  const { biWeekIndex } = getIndexInfo(dateStr, baseStart);
  const start = parseYmdLocal(baseStart);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (biWeekIndex + 1) * 14 - 1);
  return { key: `bw:${biWeekIndex}`, end };
}

/** Period key alone, for callers that only need to bucket days together. */
export const getPeriodKey = (dateStr: string, payCycle: PaymentCycle, baseStart: string) =>
  getPeriodInfo(dateStr, payCycle, baseStart).key;

/* ------------- Per-day earnings ------------- */

type DayGross = { date: string; hours: number; earnings: number; taxable: number };

/**
 * Gross pay and the taxable share of it, per day. Both payroll rules live here;
 * nothing below this point cares which one produced the numbers.
 */
function computeDayGross(
  sorted: { date: string; hours: number }[],
  hourlyRate: number,
  startDate: string,
  useUnlawfulRule: boolean
): DayGross[] {
  const biWeeklyTotals = new Map<number, number>();
  for (const r of sorted) {
    const { biWeekIndex } = getIndexInfo(r.date, startDate);
    biWeeklyTotals.set(biWeekIndex, (biWeeklyTotals.get(biWeekIndex) || 0) + (r.hours || 0));
  }

  const weeklyWorked = new Map<number, number>();
  const rows: DayGross[] = [];

  for (const r of sorted) {
    const h = r.hours || 0;
    if (h <= 0) {
      rows.push({ date: r.date, hours: 0, earnings: 0, taxable: 0 });
      continue;
    }

    const { weekIndex, biWeekIndex } = getIndexInfo(r.date, startDate);

    // 4% vacation pay for all hours in this bi-week
    const bonusMultiplier = 1 + BIWEEKLY_BONUS_RATE;

    let earnings = 0;
    let taxable = 0;

    if (useUnlawfulRule) {
      // Hours past the bi-weekly threshold are paid untaxed, spread pro-rata
      // across the days of that bi-week.
      const biWeekHours = biWeeklyTotals.get(biWeekIndex) || 0;
      let dayTaxFree = 0;
      if (biWeekHours > BIWEEKLY_TAXFREE_THRESHOLD && biWeekHours > 0) {
        const extra = biWeekHours - BIWEEKLY_TAXFREE_THRESHOLD;
        dayTaxFree = round2((h / biWeekHours) * extra);
        dayTaxFree = Math.min(dayTaxFree, h);
      }

      earnings = h * hourlyRate * bonusMultiplier;
      const taxableHours = Math.max(0, h - dayTaxFree);
      taxable = taxableHours * hourlyRate * bonusMultiplier;
    } else {
      const workedSoFar = weeklyWorked.get(weekIndex) || 0;
      const regularHours = Math.max(0, Math.min(h, WEEKLY_OVERTIME_THRESHOLD - workedSoFar));
      const overtimeHours = Math.max(0, h - regularHours);
      weeklyWorked.set(weekIndex, workedSoFar + h);

      const regularEarnings = regularHours * hourlyRate * bonusMultiplier;
      const overtimeEarnings = overtimeHours * hourlyRate * OVERTIME_MULTIPLIER * bonusMultiplier;
      earnings = regularEarnings + overtimeEarnings;
      taxable = earnings;
    }

    rows.push({ date: r.date, hours: h, earnings, taxable });
  }

  return rows;
}

/**
 * Spread one pay period's deduction across its days, in proportion to each day's
 * taxable earnings. The residual cent goes on the last contributing day so the
 * days always add back up to the period total exactly.
 */
function distribute(total: number, rows: DayGross[], totalTaxable: number): number[] {
  const out = rows.map(() => 0);
  if (total === 0 || totalTaxable <= 0) return out;

  let lastIdx = -1;
  let assigned = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].taxable <= 0) continue;
    if (lastIdx >= 0) {
      const share = round2((total * rows[lastIdx].taxable) / totalTaxable);
      out[lastIdx] = share;
      assigned += share;
    }
    lastIdx = i;
  }
  if (lastIdx >= 0) out[lastIdx] = round2(total - assigned);
  return out;
}

/**
 * Price a job's hours and withhold CPP, EI and income tax from them.
 *
 * Deductions are computed per pay period, not per day: CPP's basic exemption and
 * the income tax brackets are annual concepts, so CRA annualizes a period's pay,
 * applies the year's tables, and divides back down. The result is then spread
 * over the period's days so callers still get a per-day breakdown.
 *
 * Year-to-date caps (YMPE, MIE) reset each calendar year and are tracked per
 * job, which is correct: the annual maximums restart with each employer, and
 * this function is called once per job.
 */
export function computeDetailedDays({
  dayHours,
  hourlyRate,
  startDate,
  useUnlawfulRule = false,
  payCycle = DEFAULT_CALC_PAY_CYCLE,
}: {
  dayHours: DayHours[];
  hourlyRate: number;
  startDate: string;
  useUnlawfulRule?: boolean;
  payCycle?: PaymentCycle;
}): DetailedDay[] {
  const entries = dayHours.filter(d => d.hours != null && !isNaN(d.hours!)) as { date: string; hours: number; }[];
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const rows = computeDayGross(sorted, hourlyRate, startDate, useUnlawfulRule);

  // Bucket days into pay periods, keeping first-seen order (already chronological).
  const periods = new Map<string, { rows: DayGross[]; end: Date }>();
  for (const row of rows) {
    const { key, end } = getPeriodInfo(row.date, payCycle, startDate);
    const bucket = periods.get(key);
    if (bucket) bucket.rows.push(row);
    else periods.set(key, { rows: [row], end });
  }

  const periodsPerYear = PERIODS_PER_YEAR[payCycle];
  const ytdByYear = new Map<number, { cpp: CppYtd; ei: EiYtd }>();
  const byDate = new Map<string, DetailedDay>();

  for (const { rows: periodRows, end } of Array.from(periods.values())) {
    const taxYear = end.getFullYear();
    const rates = getTaxYearRates(taxYear);
    if (!ytdByYear.has(taxYear)) {
      ytdByYear.set(taxYear, { cpp: { pensionable: 0, base: 0, cpp2: 0 }, ei: { insurable: 0, premium: 0 } });
    }
    const ytd = ytdByYear.get(taxYear)!;

    // Untaxed earnings are not pensionable or insurable either.
    const periodTaxable = periodRows.reduce((sum, r) => sum + r.taxable, 0);

    const cpp = computeCpp(periodTaxable, rates.cpp.exemption / periodsPerYear, rates, ytd.cpp);
    const ei = computeEi(periodTaxable, rates, ytd.ei);

    const { total: annualTax } = computeIncomeTax(
      {
        annualTaxable: periodTaxable * periodsPerYear,
        annualCppCredit: cpp.creditPortion * periodsPerYear,
        annualCppDeduction: (cpp.enhancedPortion + cpp.cpp2) * periodsPerYear,
        annualEi: ei * periodsPerYear,
      },
      rates
    );

    ytd.cpp = {
      pensionable: ytd.cpp.pensionable + periodTaxable,
      base: ytd.cpp.base + cpp.base,
      cpp2: ytd.cpp.cpp2 + cpp.cpp2,
    };
    ytd.ei = { insurable: ytd.ei.insurable + periodTaxable, premium: ytd.ei.premium + ei };

    const incomeTaxByDay = distribute(round2(annualTax / periodsPerYear), periodRows, periodTaxable);
    const eiByDay = distribute(round2(ei), periodRows, periodTaxable);
    const cppByDay = distribute(round2(cpp.total), periodRows, periodTaxable);

    periodRows.forEach((row, i) => {
      const earnings = round2(row.earnings);
      byDate.set(row.date, {
        date: row.date,
        hours: row.hours,
        earnings,
        incomeTax: incomeTaxByDay[i],
        employeeInsurance: eiByDay[i],
        cpp: cppByDay[i],
        afterTax: round2(earnings - incomeTaxByDay[i] - eiByDay[i] - cppByDay[i]),
      });
    });
  }

  // Restore the original chronological order.
  return rows.map(r => byDate.get(r.date)!);
}

/* ------------- Multi-job aggregation ------------- */

/** Price one job's hours on its own rate, start date and payroll rule. */
export function computeJobEarnings(job: JobCalcInput): JobEarnings {
  const days = computeDetailedDays({
    dayHours: job.dayHours,
    hourlyRate: job.hourlyRate,
    startDate: job.startDate,
    useUnlawfulRule: isUnlawfulRuleJob(job.name),
    payCycle: job.payCycle ?? DEFAULT_CALC_PAY_CYCLE,
  });

  return {
    id: job.id,
    name: job.name,
    hourlyRate: job.hourlyRate,
    hours: round2(days.reduce((s, d) => s + d.hours, 0)),
    gross: round2(days.reduce((s, d) => s + d.earnings, 0)),
    afterTax: round2(days.reduce((s, d) => s + d.afterTax, 0)),
  };
}

/**
 * Combine every job the user holds. Each job keeps its own hourly rate, start
 * date and payroll rule; only the money is summed.
 */
export function summarizeJobs(jobs: JobCalcInput[]): AllJobsSummary {
  const perJob = jobs.map(computeJobEarnings);
  return {
    jobs: perJob,
    totalHours: round2(perJob.reduce((s, j) => s + j.hours, 0)),
    totalGross: round2(perJob.reduce((s, j) => s + j.gross, 0)),
    totalAfterTax: round2(perJob.reduce((s, j) => s + j.afterTax, 0)),
  };
}
