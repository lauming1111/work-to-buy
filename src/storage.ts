import {
  DayHours,
  Item,
  JobMeta,
  PaymentCycle,
  RosterData,
  defaultItems,
  getTorontoToday,
  ymd,
} from "./calc";

export const DEFAULT_JOB_ID = "default";
export const DEFAULT_JOB_NAME = "Main Job";
export const DEFAULT_HOURLY_RATE = 17.6;
export const DEFAULT_PAY_CYCLE: PaymentCycle = "biweekly";
export const JOBS_STORAGE_KEY = "w2b_jobs";
export const ACTIVE_JOB_STORAGE_KEY = "w2b_activeJob";
export const DARK_MODE_STORAGE_KEY = "w2b_dark";
export const COMBINE_JOBS_STORAGE_KEY = "w2b_combineJobs";

export const LEGACY_STORAGE_KEYS = {
  items: "w2b_items",
  hourlyRate: "w2b_hourlyRate",
  dayHours: "w2b_history",
  startDate: "w2b_startDate",
  currentDate: "w2b_currentDate",
  payCycle: "w2b_payCycle",
  roster: "w2b_roster",
} as const;

export type JobStorageKey = keyof typeof LEGACY_STORAGE_KEYS;

export const jobStorageKey = (jobId: string, key: JobStorageKey) => `w2b_job_${jobId}_${key}`;

export const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
};

/** localStorage throws when the quota is full; a failed write must not break the app. */
export const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const isPaymentCycle = (value: unknown): value is PaymentCycle =>
  value === "biweekly" || value === "semi-monthly" || value === "monthly";

export const cloneDefaultItems = () => defaultItems.map(item => ({ ...item }));

export const createDefaultJobData = () => ({
  items: cloneDefaultItems(),
  hourlyRate: DEFAULT_HOURLY_RATE,
  dayHours: [] as DayHours[],
  startDate: ymd(getTorontoToday()),
  currentDate: getTorontoToday(),
  payCycle: DEFAULT_PAY_CYCLE,
  roster: { weekly: {}, monthly: {} } as RosterData,
});

export const getInitialJobs = (): JobMeta[] => {
  const stored = safeParse<JobMeta[]>(localStorage.getItem(JOBS_STORAGE_KEY), []);
  return stored.length ? stored : [{ id: DEFAULT_JOB_ID, name: DEFAULT_JOB_NAME }];
};

export const getInitialActiveJobId = (jobs: JobMeta[]): string => {
  const stored = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
  if (stored && jobs.some(job => job.id === stored)) return stored;
  return jobs[0]?.id || DEFAULT_JOB_ID;
};

/** Job-scoped key first, then the pre-multi-job keys (default job only). */
export const readJobStorage = (jobId: string, key: JobStorageKey) => {
  const scoped = localStorage.getItem(jobStorageKey(jobId, key));
  if (scoped != null) return scoped;
  if (jobId === DEFAULT_JOB_ID) {
    return localStorage.getItem(LEGACY_STORAGE_KEYS[key]);
  }
  return null;
};

export const loadJobData = (jobId: string) => {
  const fallback = createDefaultJobData();
  const items = safeParse<Item[]>(readJobStorage(jobId, "items"), fallback.items);
  const hourlyRateRaw = readJobStorage(jobId, "hourlyRate");
  const hourlyRate = hourlyRateRaw != null && !isNaN(Number(hourlyRateRaw)) ? Number(hourlyRateRaw) : fallback.hourlyRate;
  const dayHours = safeParse<DayHours[]>(readJobStorage(jobId, "dayHours"), fallback.dayHours);
  const startDate = readJobStorage(jobId, "startDate") || fallback.startDate;
  const currentDateRaw = readJobStorage(jobId, "currentDate");
  const currentDateCandidate = currentDateRaw ? new Date(currentDateRaw) : fallback.currentDate;
  const currentDate = isNaN(currentDateCandidate.getTime()) ? fallback.currentDate : currentDateCandidate;
  const payCycleRaw = readJobStorage(jobId, "payCycle");
  const payCycle = isPaymentCycle(payCycleRaw) ? payCycleRaw : fallback.payCycle;
  const roster = safeParse<RosterData>(readJobStorage(jobId, "roster"), fallback.roster);
  return { items, hourlyRate, dayHours, startDate, currentDate, payCycle, roster };
};

export const clearJobStorage = (jobId: string) => {
  (Object.keys(LEGACY_STORAGE_KEYS) as JobStorageKey[]).forEach(key => {
    localStorage.removeItem(jobStorageKey(jobId, key));
    if (jobId === DEFAULT_JOB_ID) {
      localStorage.removeItem(LEGACY_STORAGE_KEYS[key]);
    }
  });
};
