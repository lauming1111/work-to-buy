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
export const INCOME_TAX_RATE = 0.117;
export const EMPLOYEE_INSURANCE_RATE = 0.0164;
export const CPP_RATE = 0.05482;
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

/** Week / bi-week buckets are counted from the job's own start date, not the calendar. */
export const getIndexInfo = (dateStr: string, baseStart: string) => {
  const start = parseYmdLocal(baseStart);
  const dt = parseYmdLocal(dateStr);
  const diffDays = Math.floor((dt.getTime() - start.getTime()) / (1000 * 3600 * 24));
  return {
    diffDays,
    weekIndex: Math.floor(diffDays / 7),
    biWeekIndex: Math.floor(diffDays / 14),
  };
};

/** The "unlawful" payroll rule is opted into by naming the job exactly "3495". */
export const isUnlawfulRuleJob = (jobName?: string | null) =>
  (jobName ?? "").trim() === UNLAWFUL_RULE_JOB_NAME;

/* ------------- Per-day earnings ------------- */
export function computeDetailedDays({
  dayHours,
  hourlyRate,
  startDate,
  useUnlawfulRule = false,
}: {
  dayHours: DayHours[];
  hourlyRate: number;
  startDate: string;
  useUnlawfulRule?: boolean;
}): DetailedDay[] {
  const entries = dayHours.filter(d => d.hours != null && !isNaN(d.hours!)) as { date: string; hours: number; }[];
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  const weeklyWorked = new Map<number, number>();
  const biWeeklyTotals = new Map<number, number>();
  for (const r of sorted) {
    const { biWeekIndex } = getIndexInfo(r.date, startDate);
    biWeeklyTotals.set(biWeekIndex, (biWeeklyTotals.get(biWeekIndex) || 0) + (r.hours || 0));
  }

  const results: DetailedDay[] = [];

  for (const r of sorted) {
    const h = r.hours || 0;
    if (h <= 0) {
      results.push({ date: r.date, hours: 0, earnings: 0, incomeTax: 0, employeeInsurance: 0, cpp: 0, afterTax: 0 });
      continue;
    }

    const { weekIndex, biWeekIndex } = getIndexInfo(r.date, startDate);
    const biWeekHours = biWeeklyTotals.get(biWeekIndex) || 0;

    // 4% vacation pay for all hours in this bi-week
    const bonusMultiplier = 1 + BIWEEKLY_BONUS_RATE;

    let earnings = 0;
    let taxableEarnings = 0;

    if (useUnlawfulRule) {
      // Calculate tax-free hours for this day (only for the unlawful rule job)
      let dayTaxFree = 0;
      if (biWeekHours > BIWEEKLY_TAXFREE_THRESHOLD && biWeekHours > 0) {
        const extra = biWeekHours - BIWEEKLY_TAXFREE_THRESHOLD;
        dayTaxFree = round2((h / biWeekHours) * extra);
        dayTaxFree = Math.min(dayTaxFree, h);
      }

      earnings = h * hourlyRate * bonusMultiplier;
      const taxableHours = Math.max(0, h - dayTaxFree);
      taxableEarnings = taxableHours * hourlyRate * bonusMultiplier;
    } else {
      const workedSoFar = weeklyWorked.get(weekIndex) || 0;
      const regularHours = Math.max(0, Math.min(h, WEEKLY_OVERTIME_THRESHOLD - workedSoFar));
      const overtimeHours = Math.max(0, h - regularHours);
      weeklyWorked.set(weekIndex, workedSoFar + h);

      const regularEarnings = regularHours * hourlyRate * bonusMultiplier;
      const overtimeEarnings = overtimeHours * hourlyRate * OVERTIME_MULTIPLIER * bonusMultiplier;
      earnings = regularEarnings + overtimeEarnings;
      taxableEarnings = earnings;
    }

    const incomeTax = round2(taxableEarnings * INCOME_TAX_RATE);
    const employeeInsurance = round2(taxableEarnings * EMPLOYEE_INSURANCE_RATE);
    const cpp = round2(taxableEarnings * CPP_RATE);

    const afterTax = round2(earnings - incomeTax - employeeInsurance - cpp);

    results.push({
      date: r.date,
      hours: h,
      earnings: round2(earnings),
      incomeTax,
      employeeInsurance,
      cpp,
      afterTax,
    });
  }

  return results;
}

/* ------------- Multi-job aggregation ------------- */

/** Price one job's hours on its own rate, start date and payroll rule. */
export function computeJobEarnings(job: JobCalcInput): JobEarnings {
  const days = computeDetailedDays({
    dayHours: job.dayHours,
    hourlyRate: job.hourlyRate,
    startDate: job.startDate,
    useUnlawfulRule: isUnlawfulRuleJob(job.name),
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
