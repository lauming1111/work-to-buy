import React, { JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import dayjs, { Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { TimePicker } from "antd";
import ram from './fun-images/rick-y-morty-rick.png';

dayjs.extend(customParseFormat);
/* ---------------------- Types ---------------------- */
type Item = {
  id: number;
  name: string;
  price: number;
  taxable: boolean;
  enabled: boolean;
};

type JobMeta = {
  id: string;
  name: string;
};

type PaymentCycle = "biweekly" | "semi-monthly" | "monthly";

type RosterData = {
  weekly: Record<string, string>;
  monthly: Record<string, string>;
};

type DayHours = {
  date: string; // "YYYY-MM-DD"
  start?: string | null; // "HH:MM"
  end?: string | null;   // "HH:MM"
  hours?: number | null; // calculated, not user input
  lunch?: boolean;       // legacy lunch toggle state
  lunchMinutes?: number | null; // minutes to subtract when lunch is enabled
  originalHours?: number | null; // <-- add this line
};

type DetailedDay = {
  date: string;
  hours: number;
  earnings: number; // gross
  incomeTax: number;
  employeeInsurance: number;
  cpp: number;
  afterTax: number;
};

type JobExport = {
  items: Item[];
  hourlyRate: number;
  dayHours: DayHours[];
  startDate: string;
  currentDate?: string;
  payCycle?: PaymentCycle;
  roster?: RosterData;
};

type AllJobsExport = {
  type: "w2b_all_jobs";
  version: 1;
  activeJobId: string;
  jobs: JobMeta[];
  jobData: Record<string, JobExport>;
};

type NormalizedJobData = {
  items: Item[];
  hourlyRate: number;
  dayHours: DayHours[];
  startDate: string;
  currentDate: Date;
  payCycle: PaymentCycle;
  roster: RosterData;
};

/* -------------------- Constants -------------------- */
const INCOME_TAX_RATE = 0.117;
const EMPLOYEE_INSURANCE_RATE = 0.0164;
const CPP_RATE = 0.05482;
const BIWEEKLY_TAXFREE_THRESHOLD = 88;
const BIWEEKLY_BONUS_RATE = 0.04; // 4% vacation pay per cycle
const WEEKLY_OVERTIME_THRESHOLD = 44;
const OVERTIME_MULTIPLIER = 1.5;
const DEFAULT_LUNCH_MINUTES = 30;

const defaultItems: Item[] = [
  { id: 1, name: "Rent", price: 0, taxable: false, enabled: true },
  { id: 2, name: "Food / Groceries", price: 0, taxable: true, enabled: true },
  { id: 3, name: "Transportation", price: 0, taxable: true, enabled: true },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseYmdLocal = (dateStr: string) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const clampLunchMinutes = (value?: number | null) => {
  if (value == null) return DEFAULT_LUNCH_MINUTES;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LUNCH_MINUTES;
  return Math.max(0, Math.min(180, Math.round(n)));
};

const getLunchMinutes = (entry?: DayHours | null) => {
  if (!entry) return 0;
  if (entry.lunchMinutes != null) return clampLunchMinutes(entry.lunchMinutes);
  if (entry.lunch === false) return 0;
  return DEFAULT_LUNCH_MINUTES;
};

const getOriginalHours = (entry: DayHours) => {
  if (entry.originalHours != null) return entry.originalHours;
  if (entry.hours != null && !entry.start && !entry.end) return entry.hours;
  return null;
};

const DEFAULT_JOB_ID = "default";
const DEFAULT_JOB_NAME = "Main Job";
const JOBS_STORAGE_KEY = "w2b_jobs";
const ACTIVE_JOB_STORAGE_KEY = "w2b_activeJob";
const LEGACY_STORAGE_KEYS = {
  items: "w2b_items",
  hourlyRate: "w2b_hourlyRate",
  dayHours: "w2b_history",
  startDate: "w2b_startDate",
  currentDate: "w2b_currentDate",
  payCycle: "w2b_payCycle",
  roster: "w2b_roster",
} as const;

const jobStorageKey = (jobId: string, key: keyof typeof LEGACY_STORAGE_KEYS) => `w2b_job_${jobId}_${key}`;

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
};

const safeSetItem = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const cloneDefaultItems = () => defaultItems.map(item => ({ ...item }));

const createDefaultJobData = () => ({
  items: cloneDefaultItems(),
  hourlyRate: 17.6,
  dayHours: [] as DayHours[],
  startDate: ymd(getTorontoToday()),
  currentDate: getTorontoToday(),
  payCycle: "biweekly" as PaymentCycle,
  roster: { weekly: {}, monthly: {} },
});

const getInitialJobs = (): JobMeta[] => {
  const stored = safeParse<JobMeta[]>(localStorage.getItem(JOBS_STORAGE_KEY), []);
  return stored.length ? stored : [{ id: DEFAULT_JOB_ID, name: DEFAULT_JOB_NAME }];
};

const getInitialActiveJobId = (jobs: JobMeta[]): string => {
  const stored = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
  if (stored && jobs.some(job => job.id === stored)) return stored;
  return jobs[0]?.id || DEFAULT_JOB_ID;
};

const readJobStorage = (jobId: string, key: keyof typeof LEGACY_STORAGE_KEYS) => {
  const scoped = localStorage.getItem(jobStorageKey(jobId, key));
  if (scoped != null) return scoped;
  if (jobId === DEFAULT_JOB_ID) {
    return localStorage.getItem(LEGACY_STORAGE_KEYS[key]);
  }
  return null;
};

const loadJobData = (jobId: string) => {
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
  const payCycle = payCycleRaw === "biweekly" || payCycleRaw === "semi-monthly" || payCycleRaw === "monthly"
    ? payCycleRaw
    : fallback.payCycle;
  const roster = safeParse<RosterData>(readJobStorage(jobId, "roster"), fallback.roster);
  return { items, hourlyRate, dayHours, startDate, currentDate, payCycle, roster };
};

const clearJobStorage = (jobId: string) => {
  (Object.keys(LEGACY_STORAGE_KEYS) as Array<keyof typeof LEGACY_STORAGE_KEYS>).forEach(key => {
    localStorage.removeItem(jobStorageKey(jobId, key));
    if (jobId === DEFAULT_JOB_ID) {
      localStorage.removeItem(LEGACY_STORAGE_KEYS[key]);
    }
  });
};

/* ---------------------- App ------------------------ */
export default function App(): JSX.Element {
  const initialJobs = getInitialJobs();
  const initialActiveJobId = getInitialActiveJobId(initialJobs);
  const initialJobData = loadJobData(initialActiveJobId);

  const [jobs, setJobs] = useState<JobMeta[]>(initialJobs);
  const [activeJobId, setActiveJobId] = useState<string>(initialActiveJobId);

  // persisted state
  const [items, setItems] = useState<Item[]>(initialJobData.items);
  const [hourlyRate, setHourlyRate] = useState<number>(initialJobData.hourlyRate);
  const [payCycle, setPayCycle] = useState<PaymentCycle>(initialJobData.payCycle);
  const [roster, setRoster] = useState<RosterData>(initialJobData.roster);
  const [dayHours, setDayHours] = useState<DayHours[]>(initialJobData.dayHours);
  const [startDate, setStartDate] = useState<string>(initialJobData.startDate);
  const [currentDate, setCurrentDate] = useState<Date>(initialJobData.currentDate);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const v = localStorage.getItem("w2b_dark");
    return v ? v === "1" : false;
  });
  const [lang, setLang] = useState<"en" | "zh-tw">("en");

  // UI transient
  const [notification, setNotification] = useState<string>("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const calGridRef = useRef<HTMLDivElement | null>(null);
  const [weekRowTemplate, setWeekRowTemplate] = useState<string | null>(null);
  // persist on change
  useEffect(() => { safeSetItem(JOBS_STORAGE_KEY, JSON.stringify(jobs)); }, [jobs]);
  useEffect(() => { safeSetItem(ACTIVE_JOB_STORAGE_KEY, activeJobId); }, [activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "items"), JSON.stringify(items)); }, [items, activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "hourlyRate"), String(hourlyRate)); }, [hourlyRate, activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "payCycle"), payCycle); }, [payCycle, activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "roster"), JSON.stringify(roster)); }, [roster, activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "dayHours"), JSON.stringify(dayHours)); }, [dayHours, activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "startDate"), startDate); }, [startDate, activeJobId]);
  useEffect(() => { safeSetItem(jobStorageKey(activeJobId, "currentDate"), currentDate.toISOString()); }, [currentDate, activeJobId]);
  useEffect(() => { safeSetItem("w2b_dark", darkMode ? "1" : "0"); }, [darkMode]);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark");
      document.documentElement.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 3000);
  };

  const activeJob = jobs.find(job => job.id === activeJobId) || jobs[0];
  const useUnlawfulRule = (activeJob?.name ?? "").trim() === "3495";
  const useSemiMonthlyRule = payCycle === "semi-monthly";
  const useMonthlyRule = payCycle === "monthly";

  const [rosterMode, setRosterMode] = useState<"weekly" | "monthly">("weekly");
  const [rosterViewer, setRosterViewer] = useState<{ src: string; scale: number } | null>(null);
  const [rosterConfirm, setRosterConfirm] = useState<{ mode: "weekly" | "monthly"; key: string } | null>(null);
  const getWeekInfo = (base: Date) => {
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      key: ymd(start),
      start: ymd(start),
      end: ymd(end),
    };
  };

  const getMonthInfoFromDate = (base: Date) => {
    const year = base.getFullYear();
    const month = base.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mm = String(month + 1).padStart(2, "0");
    const start = `${year}-${mm}-01`;
    const end = `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;
    return {
      key: `${year}-${mm}`,
      start,
      end,
    };
  };

  const monthlyRosterPeriod = useMemo(() => getMonthInfoFromDate(currentDate), [currentDate]);

  const weeklyRosterPeriods = useMemo(() => {
    if (rosterMode !== "weekly") return [] as { key: string; start: string; end: string; }[];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthStart = new Date(year, month, 1);
    const firstWeekday = monthStart.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = firstWeekday + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const gridStart = new Date(year, month, 1 - firstWeekday);
    const periods: { key: string; start: string; end: string; }[] = [];
    for (let i = 0; i < rows; i += 1) {
      const weekStart = new Date(gridStart);
      weekStart.setDate(gridStart.getDate() + i * 7);
      periods.push(getWeekInfo(weekStart));
    }
    return periods;
  }, [rosterMode, currentDate]);

  const getRosterImage = (mode: "weekly" | "monthly", key: string) => roster[mode]?.[key];

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const compressImageDataUrl = async (dataUrl: string, quality = 0.75, maxDimension = 1280) => {
    const img = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    let compressed = canvas.toDataURL("image/webp", quality);
    if (!compressed.startsWith("data:image/webp")) {
      compressed = canvas.toDataURL("image/jpeg", quality);
    }
    return compressed;
  };

  const handleRosterFile = async (ev: React.ChangeEvent<HTMLInputElement>, mode: "weekly" | "monthly", key: string) => {
    const file = ev.target.files?.[0];
    const input = ev.currentTarget;
    if (!file) return;
    try {
      const originalDataUrl = await readFileAsDataUrl(file);
      const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const compressedDataUrl = await compressImageDataUrl(
        originalDataUrl,
        isMobile ? 0.7 : 0.8,
        isMobile ? 1024 : 1600
      );
      setRoster(prev => ({
        ...prev,
        [mode]: {
          ...(prev[mode] || {}),
          [key]: compressedDataUrl,
        },
      }));
    } catch {
      try {
        const fallbackDataUrl = await readFileAsDataUrl(file);
        setRoster(prev => ({
          ...prev,
          [mode]: {
            ...(prev[mode] || {}),
            [key]: fallbackDataUrl,
          },
        }));
      } catch {
        // ignore
      }
    } finally {
      input.value = "";
    }
  };

  const clearRosterImage = (mode: "weekly" | "monthly", key: string) => {
    setRoster(prev => {
      const next = { ...prev, [mode]: { ...(prev[mode] || {}) } };
      delete next[mode][key];
      return next;
    });
  };

  const zoomInRoster = () => {
    setRosterViewer(prev => {
      if (!prev) return prev;
      const nextScale = Math.min(3, Math.round((prev.scale + 0.1) * 100) / 100);
      return { ...prev, scale: nextScale };
    });
  };

  const getSemiMonthlyInfo = (dateStr: string) => {
    const dt = parseYmdLocal(dateStr);
    const year = dt.getFullYear();
    const month = dt.getMonth();
    const day = dt.getDate();
    const half = day <= 15 ? 0 : 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDay = half === 0 ? 1 : 16;
    const endDay = half === 0 ? 15 : daysInMonth;
    const mm = String(month + 1).padStart(2, "0");
    const start = `${year}-${mm}-${String(startDay).padStart(2, "0")}`;
    const end = `${year}-${mm}-${String(endDay).padStart(2, "0")}`;
    const index = year * 24 + month * 2 + half;
    return { index, start, end };
  };

  const getMonthlyInfo = (dateStr: string) => {
    const dt = parseYmdLocal(dateStr);
    const year = dt.getFullYear();
    const month = dt.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mm = String(month + 1).padStart(2, "0");
    const start = `${year}-${mm}-01`;
    const end = `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;
    const index = year * 12 + month;
    return { index, start, end };
  };

  const persistJobData = (jobId: string) => {
    safeSetItem(jobStorageKey(jobId, "items"), JSON.stringify(items));
    safeSetItem(jobStorageKey(jobId, "hourlyRate"), String(hourlyRate));
    safeSetItem(jobStorageKey(jobId, "payCycle"), payCycle);
    safeSetItem(jobStorageKey(jobId, "roster"), JSON.stringify(roster));
    safeSetItem(jobStorageKey(jobId, "dayHours"), JSON.stringify(dayHours));
    safeSetItem(jobStorageKey(jobId, "startDate"), startDate);
    safeSetItem(jobStorageKey(jobId, "currentDate"), currentDate.toISOString());
  };

  const switchJob = (jobId: string) => {
    if (jobId === activeJobId) return;
    persistJobData(activeJobId);
    const data = loadJobData(jobId);
    setItems(data.items);
    setHourlyRate(data.hourlyRate);
    setPayCycle(data.payCycle);
    setRoster(data.roster);
    setDayHours(data.dayHours);
    setStartDate(data.startDate);
    setCurrentDate(data.currentDate);
    setActiveJobId(jobId);
  };

  const addJob = () => {
    const defaultName = `Job ${jobs.length + 1}`;
    const name = prompt("Job name:", defaultName);
    if (name === null) return;
    const trimmed = name.trim();
    const jobName = trimmed || defaultName;
    const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const nextJobs = [...jobs, { id: jobId, name: jobName }];
    persistJobData(activeJobId);
    setJobs(nextJobs);
    const data = createDefaultJobData();
    setItems(data.items);
    setHourlyRate(data.hourlyRate);
    setPayCycle(data.payCycle);
    setRoster(data.roster);
    setDayHours(data.dayHours);
    setStartDate(data.startDate);
    setCurrentDate(data.currentDate);
    setActiveJobId(jobId);
  };

  const removeJob = (jobId: string) => {
    if (jobs.length <= 1) {
      notify(labels[lang].cannotRemoveLastJob);
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const name = job?.name || labels[lang].job;
    if (!window.confirm(`${labels[lang].confirmRemoveJob} "${name}"?`)) return;
    clearJobStorage(jobId);
    const nextJobs = jobs.filter(j => j.id !== jobId);
    setJobs(nextJobs);
    if (jobId === activeJobId) {
      const nextActive = nextJobs[0].id;
      const data = loadJobData(nextActive);
      setItems(data.items);
      setHourlyRate(data.hourlyRate);
      setPayCycle(data.payCycle);
      setRoster(data.roster);
      setDayHours(data.dayHours);
      setStartDate(data.startDate);
      setCurrentDate(data.currentDate);
      setActiveJobId(nextActive);
    }
    notify(labels[lang].removedJob);
  };

  /* ---------------- helper indices ---------------- */
  const getIndexInfo = (dateStr: string, baseStart = startDate) => {
    const start = parseYmdLocal(baseStart);
    const dt = parseYmdLocal(dateStr);
    const diffDays = Math.floor((dt.getTime() - start.getTime()) / (1000 * 3600 * 24));
    return {
      diffDays,
      weekIndex: Math.floor(diffDays / 7),
      biWeekIndex: Math.floor(diffDays / 14),
    };
  };

  /* ---------------- compute detailed days ---------------- */
  const detailedHistory = useMemo((): DetailedDay[] => {
    const entries = dayHours.filter(d => d.hours != null && !isNaN(d.hours!)) as { date: string; hours: number; }[];
    if (entries.length === 0) return [];

    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

    const weeklyWorked = new Map<number, number>();
    const biWeeklyTotals = new Map<number, number>();
    for (const r of sorted) {
      const { biWeekIndex } = getIndexInfo(r.date);
      biWeeklyTotals.set(biWeekIndex, (biWeeklyTotals.get(biWeekIndex) || 0) + (r.hours || 0));
    }

    const results: DetailedDay[] = [];

    for (const r of sorted) {
      const h = r.hours || 0;
      if (h <= 0) {
        results.push({ date: r.date, hours: 0, earnings: 0, incomeTax: 0, employeeInsurance: 0, cpp: 0, afterTax: 0 });
        continue;
      }

      const { weekIndex, biWeekIndex } = getIndexInfo(r.date);
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
  }, [dayHours, hourlyRate, startDate, useUnlawfulRule]);

  /* ---------------- summaries ---------------- */
  const totalEarnedAfterTax = useMemo(() => round2(detailedHistory.reduce((s, d) => s + d.afterTax, 0)), [detailedHistory]);
  const totalItemPrice = useMemo(() => items.filter(i => i.enabled).reduce((s, i) => s + (i.price || 0), 0), [items]);
  const totalItemTax = useMemo(() => items.filter(i => i.enabled && i.taxable).reduce((s, i) => s + (i.price || 0) * INCOME_TAX_RATE, 0), [items]);
  const totalAfterTaxItemPrice = useMemo(() => round2(totalItemPrice + totalItemTax), [totalItemPrice, totalItemTax]);
  const progressPct = useMemo(() => (totalAfterTaxItemPrice > 0 ? Math.min(100, round2((totalEarnedAfterTax / totalAfterTaxItemPrice) * 100)) : 0), [totalAfterTaxItemPrice, totalEarnedAfterTax]);

  // pay-period summary (hours / earnings / tax)
  const biWeeklySummary = useMemo(() => {
    type SummaryDay = { date: string; hours: number; earnings: number; };
    type SummaryBucket = { hours: number; earned: number; days: SummaryDay[]; start?: string; end?: string; };
    type PeriodInfo = { index: number; start?: string; end?: string; };

    const map = new Map<number, SummaryBucket>();
    detailedHistory.forEach(d => {
      const periodInfo: PeriodInfo = useMonthlyRule
        ? getMonthlyInfo(d.date)
        : useSemiMonthlyRule
          ? getSemiMonthlyInfo(d.date)
          : { index: getIndexInfo(d.date).biWeekIndex };
      const key = periodInfo.index;
      const emptyBucket: SummaryBucket = { hours: 0, earned: 0, days: [], start: periodInfo.start, end: periodInfo.end };
      const cur = map.get(key) || emptyBucket;
      if (useSemiMonthlyRule || useMonthlyRule) {
        cur.start = periodInfo.start;
        cur.end = periodInfo.end;
      }
      cur.hours += d.hours;
      cur.earned += d.earnings;
      cur.days.push({ date: d.date, hours: d.hours, earnings: d.earnings });
      map.set(key, cur);
    });

    return Array.from(map.entries()).map(([idx, val], i) => ({
      index: (useSemiMonthlyRule || useMonthlyRule) ? i + 1 : idx + 1,
      hours: val.hours,
      earned: val.earned,
      days: val.days,
      start: val.start,
      end: val.end,
    }));
  }, [detailedHistory, hourlyRate, startDate, useSemiMonthlyRule, useMonthlyRule]);

  /* ---------------- UI helpers ---------------- */
  const handleHourInput = (date: string, raw: string) => {
    if (raw.trim() === "") {
      setDayHours(prev => prev.filter(p => p.date !== date));
      return;
    }
    const n = Number(raw);
    if (isNaN(n) || n < 0 || n > 24) {
      notify("Hours must be a number between 0 and 24");
      return;
    }
    setDayHours(prev => {
      const other = prev.filter(p => p.date !== date);
      const existing = prev.find(p => p.date === date);
      const lunchMinutes = getLunchMinutes(existing);
      // Always store the original entered hours
      const originalHours = n;
      const hours = Math.max(0, n - lunchMinutes / 60);
      return [
        ...other,
        {
          date,
          hours,
          lunchMinutes,
          originalHours,
        },
      ];
    });
  };

  const handleTimeInput = (date: string, field: "start" | "end", value: any) => {
    // console.log(typeof (value), value.format("HH:mm"));

    setDayHours(prev => {
      const other = prev.filter(p => p.date !== date);
      const existing = prev.find(p => p.date === date) || { date, start: "", end: "" };
      const lunchMinutes = getLunchMinutes(existing);
      const updated = { ...existing, [field]: value?.format("HH:mm"), lunchMinutes };

      let hours: number | null = null;
      if (updated.start && updated.end) {
        const [sh, sm] = updated.start.split(":").map(Number);
        const [eh, em] = updated.end.split(":").map(Number);
        const startMins = sh * 60 + sm;
        let endMins = eh * 60 + em;
        endMins -= lunchMinutes;
        hours = (endMins - startMins) / 60;
        if (hours < 0 || hours > 24) hours = null;
      }
      return [...other, { ...updated, hours }];
    });
  };

  const handleLunchMinutesInput = (date: string, raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setDayHours(prev => {
        const other = prev.filter(p => p.date !== date);
        const existing = prev.find(p => p.date === date) || { date };
        const updated: DayHours = { ...existing, lunchMinutes: null };
        return [...other, updated];
      });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const lunchMinutes = clampLunchMinutes(parsed);
    setDayHours(prev => {
      const other = prev.filter(p => p.date !== date);
      const existing = prev.find(p => p.date === date) || { date };
      const updated: DayHours = { ...existing, lunchMinutes };
      const originalHours = getOriginalHours(updated);

      if (updated.start && updated.end) {
        const [sh, sm] = updated.start.split(":").map(Number);
        const [eh, em] = updated.end.split(":").map(Number);
        const startMins = sh * 60 + sm;
        const endMins = eh * 60 + em;
        let hours = (endMins - startMins) / 60;
        hours -= lunchMinutes / 60;
        updated.hours = (hours >= 0 && hours <= 24) ? round2(hours) : null;
      } else if (originalHours != null && (!updated.start && !updated.end)) {
        updated.originalHours = originalHours;
        updated.hours = Math.max(0, round2(originalHours - lunchMinutes / 60));
      }

      return [...other, updated];
    });
  };

  const resetMonthHours = () => {
    // ask user to confirm before resetting
    setShowResetConfirm(true);
  };

  const confirmResetMonth = () => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    const prefix = `${y}-${m}-`;
    setDayHours(prev => prev.filter(h => !h.date.startsWith(prefix)));
    setShowResetConfirm(false);
    notify(labels[lang].monthReset);
  };

  const autoFillWeekdays = () => {
    const val = prompt(labels[lang].autoFill + " (" + labels[lang].hoursPlaceholder + "):", "8");
    if (val === null) return;
    const h = Number(val || "8");
    if (isNaN(h) || h < 0 || h > 24) { notify(labels[lang].invalidHour); return; }
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
    const entries: DayHours[] = [];
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d);
      const wk = dt.getDay();
      if (wk !== 0 && wk !== 6) {
        const dateStr = `${prefix}${String(d).padStart(2, "0")}`;
        entries.push({ date: dateStr, hours: h });
      }
    }
    setDayHours(prev => {
      const filtered = prev.filter(p => !p.date.startsWith(prefix));
      return [...filtered, ...entries];
    });
    notify(labels[lang].autoFillDone);
  };

  const addItem = () => setItems(prev => [...prev, { id: Date.now(), name: `Item ${prev.length + 1}`, price: 0, taxable: true, enabled: true }]);
  const removeItem = (id: number) => setItems(prev => prev.filter(i => i.id !== id));

  // navigation
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  // export / import JSON
  const normalizeJobList = (raw: any): JobMeta[] => {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const normalized: JobMeta[] = [];
    raw.forEach((job: any) => {
      if (!job || typeof job.id !== "string" || typeof job.name !== "string") return;
      if (!job.id.trim() || seen.has(job.id)) return;
      seen.add(job.id);
      normalized.push({ id: job.id, name: job.name });
    });
    return normalized;
  };

  const normalizeJobData = (raw?: JobExport | null): NormalizedJobData => {
    const fallback = createDefaultJobData();
    const items = raw && Array.isArray(raw.items) ? raw.items : fallback.items;
    const hourlyRate = raw && raw.hourlyRate != null && !isNaN(Number(raw.hourlyRate))
      ? Number(raw.hourlyRate)
      : fallback.hourlyRate;
    const dayHours = raw && Array.isArray(raw.dayHours) ? raw.dayHours : fallback.dayHours;
    const startDate = raw && typeof raw.startDate === "string" && raw.startDate ? raw.startDate : fallback.startDate;
    const currentDateCandidate = raw && raw.currentDate ? new Date(raw.currentDate) : fallback.currentDate;
    const currentDate = isNaN(currentDateCandidate.getTime()) ? fallback.currentDate : currentDateCandidate;
    const payCycle = raw && (raw.payCycle === "biweekly" || raw.payCycle === "semi-monthly" || raw.payCycle === "monthly")
      ? raw.payCycle
      : fallback.payCycle;
    const roster = raw && raw.roster && typeof raw.roster === "object"
      ? {
          weekly: (raw.roster as any).weekly && typeof (raw.roster as any).weekly === "object" ? (raw.roster as any).weekly : {},
          monthly: (raw.roster as any).monthly && typeof (raw.roster as any).monthly === "object" ? (raw.roster as any).monthly : {},
        }
      : fallback.roster;
    return { items, hourlyRate, dayHours, startDate, currentDate, payCycle, roster };
  };

  const buildJobExport = (jobId: string): JobExport => {
    const data = jobId === activeJobId
      ? { items, hourlyRate, dayHours, startDate, currentDate, payCycle, roster }
      : loadJobData(jobId);
    return {
      items: data.items,
      hourlyRate: data.hourlyRate,
      dayHours: data.dayHours,
      startDate: data.startDate,
      currentDate: data.currentDate.toISOString(),
      payCycle: data.payCycle,
      roster: data.roster,
    };
  };

  const exportData = () => {
    const out = {
      jobName: activeJob?.name,
      items,
      hourlyRate,
      startDate,
      dayHours,
      payCycle,
      roster,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-to-buy-${ymd(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(labels[lang].exported);
  };

  const exportAllData = () => {
    const jobData: Record<string, JobExport> = {};
    jobs.forEach(job => {
      jobData[job.id] = buildJobExport(job.id);
    });
    const out: AllJobsExport = {
      type: "w2b_all_jobs",
      version: 1,
      activeJobId,
      jobs,
      jobData,
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `work-to-buy-all-${ymd(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify(labels[lang].exportedAll);
  };

  const importAllJobs = (payload: AllJobsExport) => {
    const nextJobs = normalizeJobList(payload.jobs);
    if (nextJobs.length === 0) {
      notify(labels[lang].invalidImport);
      return;
    }
    const jobData = payload.jobData && typeof payload.jobData === "object" ? payload.jobData : {};
    const jobDataMap = jobData as Record<string, JobExport>;
    jobs.forEach(job => clearJobStorage(job.id));
    nextJobs.forEach(job => {
      const normalized = normalizeJobData(jobDataMap[job.id]);
      safeSetItem(jobStorageKey(job.id, "items"), JSON.stringify(normalized.items));
      safeSetItem(jobStorageKey(job.id, "hourlyRate"), String(normalized.hourlyRate));
      safeSetItem(jobStorageKey(job.id, "payCycle"), normalized.payCycle);
      safeSetItem(jobStorageKey(job.id, "roster"), JSON.stringify(normalized.roster));
      safeSetItem(jobStorageKey(job.id, "dayHours"), JSON.stringify(normalized.dayHours));
      safeSetItem(jobStorageKey(job.id, "startDate"), normalized.startDate);
      safeSetItem(jobStorageKey(job.id, "currentDate"), normalized.currentDate.toISOString());
    });

    const nextActive = typeof payload.activeJobId === "string" && nextJobs.some(job => job.id === payload.activeJobId)
      ? payload.activeJobId
      : nextJobs[0].id;
    const activeData = normalizeJobData(jobDataMap[nextActive]);

    setJobs(nextJobs);
    setActiveJobId(nextActive);
    setItems(activeData.items);
    setHourlyRate(activeData.hourlyRate);
    setPayCycle(activeData.payCycle);
    setRoster(activeData.roster);
    setDayHours(activeData.dayHours);
    setStartDate(activeData.startDate);
    setCurrentDate(activeData.currentDate);
    notify(labels[lang].importedAll);
  };

  const handleImportFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(String(e.target?.result || ""));
        if (parsed && Array.isArray(parsed.jobs) && parsed.jobData && typeof parsed.jobData === "object") {
          importAllJobs(parsed as AllJobsExport);
          return;
        }
        if (parsed.items) setItems(parsed.items);
        if (parsed.hourlyRate) setHourlyRate(Number(parsed.hourlyRate));
        if (parsed.payCycle && (parsed.payCycle === "biweekly" || parsed.payCycle === "semi-monthly" || parsed.payCycle === "monthly")) setPayCycle(parsed.payCycle);
        if (parsed.roster && typeof parsed.roster === "object") {
          const rosterParsed = {
            weekly: parsed.roster.weekly && typeof parsed.roster.weekly === "object" ? parsed.roster.weekly : {},
            monthly: parsed.roster.monthly && typeof parsed.roster.monthly === "object" ? parsed.roster.monthly : {},
          };
          setRoster(rosterParsed);
        }
        if (parsed.startDate) setStartDate(parsed.startDate);
        if (parsed.dayHours) setDayHours(parsed.dayHours);
        notify(labels[lang].imported);
      } catch (err) {
        notify(labels[lang].invalidImport);
      }
    };
    reader.readAsText(file);
    ev.currentTarget.value = "";
  };

  const saveAll = () => {
    persistJobData(activeJobId);
    safeSetItem(JOBS_STORAGE_KEY, JSON.stringify(jobs));
    safeSetItem(ACTIVE_JOB_STORAGE_KEY, activeJobId);
    safeSetItem("w2b_dark", darkMode ? "1" : "0");
    notify("Saved");
  };

  const clearAll = () => setShowClearConfirm(true);
  const confirmClearAll = () => {
    clearJobStorage(activeJobId);
    setItems(cloneDefaultItems());
    setDayHours([]);
    setHourlyRate(17.6);
    setPayCycle("biweekly");
    setRoster({ weekly: {}, monthly: {} });
    setStartDate(ymd(getTorontoToday()));
    setCurrentDate(getTorontoToday());
    setDarkMode(false);
    setShowClearConfirm(false);
    notify("All cleared");
  };

  /* ---------------- calendar generation ---------------- */
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthStart = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = monthStart.getDay(); // 0..6
  const totalCells = firstWeekday + daysInMonth;
  const rows = Math.ceil(totalCells / 7);
  const totalGrid = rows * 7;
  const todayStr = ymd(getTorontoToday());

  useLayoutEffect(() => {
    if (!calGridRef.current || rows <= 0) return;
    const node = calGridRef.current;
    let raf = 0;

    const measure = () => {
      if (!node) return;
      const cells = Array.from(node.querySelectorAll<HTMLElement>(".cal-cell"));
      if (cells.length === 0) return;
      const heights = Array.from({ length: rows }, () => 0);
      cells.forEach((cell, idx) => {
        const row = Math.floor(idx / 7);
        const h = cell.getBoundingClientRect().height;
        if (h > heights[row]) heights[row] = h;
      });
      if (heights.every(h => h > 0)) {
        const next = heights.map(h => `${Math.ceil(h)}px`).join(" ");
        setWeekRowTemplate(prev => (prev === next ? prev : next));
      }
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    schedule();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(node);
    } else {
      window.addEventListener("resize", schedule);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", schedule);
    };
  }, [rows]);

  /* quick map for lookup */
  const detailedMap = useMemo(() => {
    const m = new Map<string, DetailedDay>();
    detailedHistory.forEach(d => m.set(d.date, d));
    return m;
  }, [detailedHistory]);

  /* ---------------------- UI ---------------------- */
  // Language labels
  const labels = {
    en: {
      confirmResetTitle: "Reset this month's hours?",
      okReset: "OK, Reset",
      switch: "中文",
      title: "Work Hours Tracker",
      info: "Information",
      totalEarned: "Total Earned After Tax",
      totalItem: "Total Item Price After Tax",
      totalTax: "Total Item Tax",
      progress: "Total Progress",
      autoFill: "Auto-fill Weekdays",
      autoFillDone: "Weekdays auto-filled",
      reset: "Reset Month Hours",
      save: "Save",
      clear: "Clear All",
      addItem: "+ Add Item",
      itemList: "Item List",
      hourlyRate: "Hourly Rate",
      startDate: "Start Date",
      payCycle: "Pay Cycle",
      roster: "Roster",
      rosterPeriod: "Roster Period",
      rosterWeekly: "Weekly",
      rosterMonthly: "Monthly",
      rosterUpload: "Upload Image",
      rosterRemove: "Remove Photo",
      rosterRemoveConfirm: "Remove this roster image?",
      rosterRemoveOk: "Yes, Remove",
      rosterEmpty: "No roster image",
      rosterHasImage: "Image saved",
      rosterView: "View Image",
      rosterZoomIn: "Zoom In",
      rosterClose: "Close",
      export: "Export Data",
      exportAll: "Export All Jobs",
      import: "Import Data",
      job: "Job",
      removeJob: "Remove Job",
      quickSave: "Quick Save",
      details: "Details",
      noRecords: "No records",
      lunchMinutesLabel: "Lunch (min)",
      resetHours: "Reset Hours",
      prevMonth: "Prev",
      nextMonth: "Next",
      imported: "Imported data",
      importedAll: "Imported all jobs",
      invalidImport: "Invalid import file",
      exported: "Exported JSON",
      exportedAll: "Exported all jobs",
      confirmRemoveJob: "Remove job",
      removedJob: "Removed job",
      cannotRemoveLastJob: "At least one job must remain",
      saved: "Saved",
      allCleared: "All cleared",
      lightMode: "Light",
      darkMode: "Dark",
      hoursPlaceholder: "Hours",
      confirmClearTitle: "Clear ALL data (items, hours, settings)?",
      cancel: "Cancel",
      okClear: "OK, Clear",
      monthReset: "This month's hours reset",
      invalidHour: "Invalid hour",
      disclaimerLine1: "This website is generated by Ming and his AI friend, actual results may vary.",
      disclaimerLine2: "Check my profile to know more about me!",
    },
    "zh-tw": {
      confirmResetTitle: "是否重設本月工時？",
      okReset: "確認重設",
      switch: "English",
      title: "工時記錄器",
      info: "資訊",
      totalEarned: "稅後總收入",
      totalItem: "稅後總項目金額",
      totalTax: "項目稅金",
      progress: "總進度",
      autoFill: "自動填寫平日",
      autoFillDone: "平日已自動填入",
      reset: "重設本月工時",
      save: "儲存",
      clear: "全部清除",
      addItem: "+ 新增項目",
      itemList: "項目清單",
      hourlyRate: "時薪",
      startDate: "開始日期",
      payCycle: "發薪週期",
      roster: "排班",
      rosterPeriod: "排班週期",
      rosterWeekly: "每週",
      rosterMonthly: "每月",
      rosterUpload: "上傳圖片",
      rosterRemove: "移除照片",
      rosterRemoveConfirm: "要移除這張排班照片嗎？",
      rosterRemoveOk: "確認移除",
      rosterEmpty: "尚無排班照片",
      rosterHasImage: "已儲存照片",
      rosterView: "查看照片",
      rosterZoomIn: "放大",
      rosterClose: "關閉",
      export: "匯出資料",
      exportAll: "匯出所有工作",
      import: "匯入資料",
      job: "工作",
      removeJob: "移除工作",
      quickSave: "快速儲存",
      details: "明細",
      noRecords: "無紀錄",
      lunchMinutesLabel: "午休(分鐘)",
      resetHours: "重設工時",
      prevMonth: "上個月",
      nextMonth: "下個月",
      imported: "已匯入資料",
      importedAll: "已匯入所有工作",
      invalidImport: "匯入檔案格式錯誤",
      exported: "已匯出 JSON",
      exportedAll: "已匯出所有工作",
      confirmRemoveJob: "移除工作",
      removedJob: "已移除工作",
      cannotRemoveLastJob: "至少保留一個工作",
      saved: "已儲存",
      allCleared: "已全部清除",
      lightMode: "淺色",
      darkMode: "深色",
      hoursPlaceholder: "工時",
      confirmClearTitle: "是否清除所有資料（項目、工時、設定）？",
      cancel: "取消",
      okClear: "確認清除",
      monthReset: "已重設本月工時",
      invalidHour: "無效的工時",
      disclaimerLine1: "此網站由 Ming 及其 AI 朋友建立，實際結果可能會不同。",
      disclaimerLine2: "查看我的個人檔案以了解更多！",
    }
  };

  return (
    <div className={`big-container ${darkMode ? "dark" : "light"}`}>
      {/* header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="title-blob">{labels[lang].title}</h1>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Language Switch Button */}
          <button
            className="btn small header-btn"
            onClick={() => setLang(lang === "en" ? "zh-tw" : "en")}
          >
            {labels[lang].switch}
          </button>
          <button className="btn small header-btn" onClick={() => { setDarkMode(d => !d); notify(darkMode ? labels[lang].lightMode : labels[lang].darkMode); }}>
            {darkMode ? labels[lang].lightMode : labels[lang].darkMode}
          </button>
        </div>
      </header>

      {/* Job tabs */}
      <div className="job-tabs">
        <div className="job-tabs-scroll">
          {jobs.map(job => (
            <button
              key={job.id}
              className={`job-tab ${job.id === activeJobId ? "active" : ""}`}
              onClick={() => switchJob(job.id)}
              title={job.name}
            >
              {job.name}
            </button>
          ))}
        </div>
        <div className="job-actions">
          <button className="btn small primary" onClick={addJob}>+ Job</button>
          <button className="btn small soft-danger" onClick={() => removeJob(activeJobId)} disabled={jobs.length <= 1}>
            {labels[lang].removeJob}
          </button>
        </div>
      </div>

      {/* Information */}
      <div className="card info-card">
        <h2>{labels[lang].info}</h2>
        <div className="info-grid">
          <div className="info-item">
            <div className="label">{labels[lang].totalEarned}</div>
            <div className="value">${totalEarnedAfterTax.toFixed(2)}</div>
          </div>
          <div className="info-item">
            <div className="label">{labels[lang].totalItem}</div>
            <div className="value">${totalAfterTaxItemPrice.toFixed(2)}</div>
          </div>
          <div className="info-item">
            <div className="label">{labels[lang].totalTax}</div>
            <div className="value">${totalItemTax.toFixed(2)}</div>
          </div>
        </div>
        <div className="progress-row">
          <div className="progress-label">{labels[lang].progress}</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="progress-number">{progressPct.toFixed(2)}%</div>
        </div>
      </div>

      {/* Controls (note: Prev / Next moved to calendar header) */}
      <div className="card controls">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label className="small-label">{labels[lang].hourlyRate}</label>
            <input className="control-input" type="number" value={hourlyRate} onChange={e => setHourlyRate(Number(e.target.value))} />
          </div>

          <div>
            <label className="small-label">{labels[lang].startDate}</label>
            <input className="control-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          <div>
            <label className="small-label">{labels[lang].payCycle}</label>
            <select className="control-input" value={payCycle} onChange={e => setPayCycle(e.target.value as PaymentCycle)} >
              <option value="biweekly">Bi-weekly</option>
              <option value="semi-monthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          <div style={{ marginTop: 25, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={autoFillWeekdays}>{labels[lang].autoFill}</button>
            <button className="btn warn" onClick={resetMonthHours}>{labels[lang].reset}</button>
            <button className="btn success" onClick={saveAll}>{labels[lang].save}</button>
            <button className="btn danger" onClick={() => setShowClearConfirm(true)}>{labels[lang].clear}</button>
          </div>
        </div>

      </div>

      {/* Items */}
      <div className="card">
        <h3>{labels[lang].itemList}</h3>
        <div className="items-scroll">
          <table className="items-table">
            <thead>
              <tr>
                {[
                  <th key="enabled" style={{ width: 36 }} />,
                  <th key="name">Name</th>,
                  <th key="price" style={{ width: 140 }}>Price</th>,
                  <th key="taxable" style={{ width: 120 }}>Taxable</th>,
                  <th key="remove" style={{ width: 80 }}>Remove</th>,
                ]}
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  {[
                    <td key="enabled">
                      <input type="checkbox" checked={it.enabled} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, enabled: e.target.checked } : p))} />
                    </td>,
                    <td key="name">
                      <input className="item-name" value={it.name} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, name: e.target.value } : p))} />
                    </td>,
                    <td key="price">
                      <input type="number" value={it.price} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, price: Number(e.target.value) } : p))} />
                    </td>,
                    <td key="taxable">
                      <input type="checkbox" checked={it.taxable} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, taxable: e.target.checked } : p))} />
                    </td>,
                    <td key="remove">
                      <button className="btn sm danger" onClick={() => removeItem(it.id)}>✕</button>
                    </td>,
                  ]}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={addItem}>{labels[lang].addItem}</button>
        </div>
      </div>

      {/* Calendar + Roster (Prev/Month/Next on top of calendar) */}
      <div className="calendar-summary-scroll">
        <div className="calendar-summary-wrap" style={{ display: "flex", gap: 12 }}>
        <div className="card calendar-card" style={{ flex: 4, display: "flex", flexDirection: "column" }}>
          <div className="calendar-header" style={{ height: 40, display: "flex", alignItems: "center" }}>
            <div className="calendar-nav">
              <button className="btn small calendar-prev" onClick={prevMonth}>{labels[lang].prevMonth}</button>
              <div className="month-title">{currentDate.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>

              <button className="btn small calendar-next" onClick={nextMonth}>{labels[lang].nextMonth}</button>
            </div>
          </div>

          <div className="cal-head grid-7" style={{ height: 30 }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d} className="cal-head-cell">{d}</div>)}
          </div>

          <div
            ref={calGridRef}
            className="cal-grid"
            style={{
              flex: 1,
              display: "grid",
              gridTemplateRows: weekRowTemplate ?? `repeat(${rows}, 1fr)`,
            }}
          >
            {Array.from({ length: totalGrid }).map((_, idx) => {
              const dayNum = idx - firstWeekday + 1;
              const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
              if (!inMonth) return <div key={idx} className="cal-cell empty" />;
              const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
              const rec = detailedMap.get(dateStr);
              const rawEntry = dayHours.find(h => h.date === dateStr);
              const isToday = dateStr === todayStr;
              const isStart = dateStr === startDate;

              const { biWeekIndex } = getIndexInfo(dateStr);
              const periodIndex = useMonthlyRule
                ? getMonthlyInfo(dateStr).index
                : useSemiMonthlyRule
                  ? getSemiMonthlyInfo(dateStr).index
                  : biWeekIndex;
              const bgColor = BIWEEK_COLORS[periodIndex % BIWEEK_COLORS.length];

              return (
                <div key={idx} className={`cal-cell ${isToday ? "today" : ""} ${isStart ? "start" : ""}`} style={{
                  background: bgColor,
                  border: isToday ? "2px solid #1976d2" : undefined,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: 2,
                  minWidth: 0,
                  position: "relative",
                }}>
                  <div className="cal-daynum">{dayNum}</div>

                  {/* Start/End time input, larger for mobile */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, width: "100%", alignItems: "center" }}>
                    <TimePicker
                      className="cal-input"
                      value={rawEntry?.start ? dayjs(rawEntry?.start, 'HH:mm') : undefined}
                      onChange={e => handleTimeInput(dateStr, "start", e)}
                      defaultOpenValue={dayjs('00:00', 'HH:mm')} format={'HH:mm'}
                      needConfirm={true}
                    />
                    <TimePicker
                      className="cal-input"
                      value={rawEntry?.end ? dayjs(rawEntry?.end, 'HH:mm') : undefined}
                      onChange={e => handleTimeInput(dateStr, "end", e)}
                      defaultOpenValue={dayjs('00:00', 'HH:mm')} format={'HH:mm'}
                      needConfirm={true} />
                  </div>

                  {/* Old: Direct hours input for backward compatibility */}
                  <input
                    className="cal-input"
                    type="number"
                    min={0}
                    max={24}
                    step={0.25}
                    style={{
                      width: "100%",
                      maxWidth: 110,
                      fontSize: 18,
                      marginTop: 2,
                      boxSizing: "border-box",
                    }}
                    value={
                      rawEntry?.originalHours != null && (!rawEntry?.start && !rawEntry?.end)
                        ? rawEntry.originalHours
                        : rawEntry?.hours != null && (!rawEntry?.start && !rawEntry?.end)
                          ? rawEntry.hours
                          : ""
                    }
                    onChange={e => handleHourInput(dateStr, e.target.value)}
                    placeholder={labels[lang].hoursPlaceholder}
                  />

                  {/* Show calculated hours */}
                  <div className="cal-hours" style={{ fontSize: 13, marginTop: 2 }}>
                    {rawEntry?.hours != null && !isNaN(rawEntry.hours) ? `${rawEntry.hours.toFixed(2)}h` : ""}
                  </div>

                  {/* daily after-tax (if exists) */}
                  <div className="cal-earn" style={{ fontSize: 13 }}>
                    {rec ? `$${rec.afterTax.toFixed(2)}` : ""}
                  </div>

                  {/* Lunch minutes (placed above reset button) */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <div className="lunch-minutes">
                      <label className="lunch-minutes-label" htmlFor={`lunch-minutes-${dateStr}`}>
                        {labels[lang].lunchMinutesLabel}
                      </label>
                      <input
                        id={`lunch-minutes-${dateStr}`}
                        className="cal-input lunch-minutes-input"
                        type="number"
                        min={0}
                        max={180}
                        step={5}
                        value={rawEntry?.lunchMinutes ?? ""}
                        onChange={e => handleLunchMinutesInput(dateStr, e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Reset button for manual hours (uses translated label) */}
                  <button
                    className="btn small"
                    style={{
                      marginBottom: 2,
                      width: "100%",
                      maxWidth: 110,
                      fontSize: 12,
                      padding: "2px 0",
                      boxSizing: "border-box",
                    }}
                    onClick={() => handleHourInput(dateStr, "")}
                    tabIndex={0}
                    aria-label={labels[lang].resetHours}
                  >
                    {labels[lang].resetHours}
                  </button>
                </div>
                );
              })}
            </div>
          </div>

        <div className="card roster-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div className="calendar-header" style={{ height: 40, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>{labels[lang].roster}</h3>
            <select className="control-input" style={{ width: "auto", margin: 0 }} value={rosterMode} onChange={e => setRosterMode(e.target.value as "weekly" | "monthly")}>
              <option value="weekly">{labels[lang].rosterWeekly}</option>
              <option value="monthly">{labels[lang].rosterMonthly}</option>
            </select>
          </div>
          <div className="cal-head" style={{ visibility: "hidden", height: 30 }}>
            <div className="cal-head-cell">&nbsp;</div>
          </div>

          <div
            className="roster-list"
            style={{
              flex: 1,
              display: "grid",
              gridTemplateRows: rosterMode === "weekly"
                ? (weekRowTemplate ?? `repeat(${rows}, 1fr)`)
                : "1fr",
            }}
          >
              {(rosterMode === "weekly" ? weeklyRosterPeriods : [monthlyRosterPeriod]).map(period => {
                const image = getRosterImage(rosterMode, period.key);
                const spanAll = rosterMode === "monthly";
                return (
                  <div key={`${rosterMode}-${period.key}`} className="roster-item" style={spanAll ? { gridRow: "1 / -1" } : undefined}>
                  {image && (
                    <button
                      type="button"
                      className="roster-remove-x"
                      onClick={() => setRosterConfirm({ mode: rosterMode, key: period.key })}
                      aria-label={labels[lang].rosterRemove}
                      title={labels[lang].rosterRemove}
                    >
                      X
                    </button>
                  )}
                  <div className="roster-meta">
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{period.start} ~ {period.end}</div>
                    {!image && (
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>
                        {labels[lang].rosterEmpty}
                      </div>
                    )}
                  </div>

                  <div className="roster-actions">
                    <div className="roster-actions-buttons">
                      {image && (
                        <button
                          type="button"
                          className="roster-preview"
                          onClick={() => setRosterViewer({ src: image, scale: 1 })}
                          aria-label={labels[lang].rosterView}
                        >
                          <img src={image} alt="roster preview" />
                        </button>
                      )}
                      <label className="btn primary file-upload-btn roster-upload-btn">
                        {labels[lang].rosterUpload}
                        <input type="file" accept="image/*" onChange={e => handleRosterFile(e, rosterMode, period.key)} className="file-input-hidden" />
                      </label>
                      <button className="btn" onClick={() => image && setRosterViewer({ src: image, scale: 1 })} disabled={!image}>{labels[lang].rosterView}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
      </div>
      </div>
      </div>

      {/* Export / Import / Save / Clear */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={exportData}>{labels[lang].export}</button>
        <button className="btn primary" onClick={exportAllData}>{labels[lang].exportAll}</button>

        <label className="btn primary">
          {labels[lang].import}
          <input type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
        </label>

        <button className="btn" onClick={saveAll}>{labels[lang].quickSave}</button>
        <button className="btn danger" onClick={() => setShowClearConfirm(true)}>{labels[lang].clear}</button>
      </div>

      <div className="card biweekly-card">
        <h3>{useMonthlyRule ? "Monthly Summary" : useSemiMonthlyRule ? "Pay Period Summary" : "Bi-weekly Summary"}</h3>
        <table className="items-table">
          <thead>
            <tr>
              {[
                <th key="period">Period</th>,
                <th key="hrs">Hrs</th>,
                <th key="period-date">Period Date</th>,
                <th key="earnings">{useUnlawfulRule ? "Earnings (<=88)" : "Earnings"}</th>,
                <th key="overtime">{useUnlawfulRule ? "Earnings (>88)" : "Overtime Earnings"}</th>,
                <th key="tax">Income Tax</th>,
                <th key="ei">EI</th>,
                <th key="cpp">CPP</th>,
                <th key="net">{useUnlawfulRule ? "Net (<88)" : "Net"}</th>,
                <th key="takehome">Take-Home Pay</th>,
              ]}
            </tr>
          </thead>
          <tbody>
            {biWeeklySummary.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center" }}>No data</td></tr>}
            {biWeeklySummary.map((b, i) => {
              const periodDays = b.days || [];
              const periodDates = (useSemiMonthlyRule || useMonthlyRule) && b.start && b.end
                ? `${b.start} ~ ${b.end}`
                : (periodDays.length > 0 ? `${periodDays[0].date} ~ ${periodDays[periodDays.length - 1].date}` : "");
              const periodDetails = detailedHistory.filter(d => periodDays.some(day => day.date === d.date));
              const hours = periodDetails.reduce((sum, d) => sum + d.hours, 0);

              // Calculate earnings split for this period
              let regularEarnings = 0;
              let overtimeEarnings = 0;
              const bonusMultiplier = 1 + BIWEEKLY_BONUS_RATE;
              if (useUnlawfulRule) {
                let taxedHours = 0;
                for (const d of periodDetails) {
                  const h = d.hours;
                  const taxedLeft = Math.max(0, BIWEEKLY_TAXFREE_THRESHOLD - taxedHours);
                  const thisTaxed = Math.min(h, taxedLeft);
                  const thisOver = h - thisTaxed;
                  taxedHours += thisTaxed;
                  regularEarnings += thisTaxed * hourlyRate * bonusMultiplier;
                  overtimeEarnings += thisOver * hourlyRate * bonusMultiplier;
                }
              } else {
                const weeklyWorked = new Map<number, number>();
                for (const d of periodDetails) {
                  const { weekIndex } = getIndexInfo(d.date);
                  const workedSoFar = weeklyWorked.get(weekIndex) || 0;
                  const regularHours = Math.max(0, Math.min(d.hours, WEEKLY_OVERTIME_THRESHOLD - workedSoFar));
                  const overtimeHours = Math.max(0, d.hours - regularHours);
                  weeklyWorked.set(weekIndex, workedSoFar + d.hours);
                  regularEarnings += regularHours * hourlyRate * bonusMultiplier;
                  overtimeEarnings += overtimeHours * hourlyRate * OVERTIME_MULTIPLIER * bonusMultiplier;
                }
              }

              // Deductions for regular hours (unlawful rule display)
              const incomeTaxRegular = round2(regularEarnings * INCOME_TAX_RATE);
              const employeeInsuranceRegular = round2(regularEarnings * EMPLOYEE_INSURANCE_RATE);
              const cppRegular = round2(regularEarnings * CPP_RATE);
              const afterTaxRegular = round2(regularEarnings - incomeTaxRegular - employeeInsuranceRegular - cppRegular);

              // Deductions for all hours (lawful rule)
              const incomeTaxTotal = periodDetails.reduce((sum, d) => sum + d.incomeTax, 0);
              const employeeInsuranceTotal = periodDetails.reduce((sum, d) => sum + d.employeeInsurance, 0);
              const cppTotal = periodDetails.reduce((sum, d) => sum + d.cpp, 0);
              const afterTaxTotal = periodDetails.reduce((sum, d) => sum + d.afterTax, 0);

              const displayIncomeTax = useUnlawfulRule ? incomeTaxRegular : incomeTaxTotal;
              const displayEmployeeInsurance = useUnlawfulRule ? employeeInsuranceRegular : employeeInsuranceTotal;
              const displayCpp = useUnlawfulRule ? cppRegular : cppTotal;
              const displayNet = useUnlawfulRule ? afterTaxRegular : afterTaxTotal;
              const displayTakeHome = useUnlawfulRule ? afterTaxRegular + overtimeEarnings : afterTaxTotal;

              return (
                <tr key={b.index}>
                  {[
                    <td key="index">{b.index}</td>,
                    <td key="hours">{round2(hours)}</td>,
                    <td key="dates">{periodDates}</td>,
                    <td key="regular">${round2(regularEarnings).toFixed(2)}</td>,
                    <td key="overtime">${round2(overtimeEarnings).toFixed(2)}</td>,
                    <td key="income-tax">${round2(displayIncomeTax).toFixed(2)}</td>,
                    <td key="ei">${round2(displayEmployeeInsurance).toFixed(2)}</td>,
                    <td key="cpp">${round2(displayCpp).toFixed(2)}</td>,
                    <td key="net">${round2(displayNet).toFixed(2)}</td>,
                    <td key="take-home">${round2(displayTakeHome).toFixed(2)}</td>,
                  ]}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Details / History */}
      <div className="card">
        <h3>{labels[lang].details}</h3>
        <div className="details-scroll">
          <table className="details-table">
            <thead>
              <tr>
                {[
                  <th key="date">Date</th>,
                  <th key="hours">Hours</th>,
                  <th key="earnings">Earnings</th>,
                  <th key="tax">Income Tax</th>,
                  <th key="ei">Employee Insurance</th>,
                  <th key="cpp">CPP</th>,
                  <th key="after">After Tax</th>,
                ]}
              </tr>
            </thead>
            <tbody>
              {detailedHistory.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center" }}>{labels[lang].noRecords}</td>
                </tr>
              )}
              {detailedHistory.map(d => (
                <tr key={d.date}>
                  {[
                    <td key="date">{d.date}</td>,
                    <td key="hours">{d.hours.toFixed(2)}</td>,
                    <td key="earnings">${d.earnings.toFixed(2)}</td>,
                    <td key="tax">${d.incomeTax.toFixed(2)}</td>,
                    <td key="ei">${d.employeeInsurance.toFixed(2)}</td>,
                    <td key="cpp">${d.cpp.toFixed(2)}</td>,
                    <td key="after">${d.afterTax.toFixed(2)}</td>,
                  ]}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* roster viewer modal */}
      {rosterViewer && (
        <div className="modal-backdrop" onClick={() => setRosterViewer(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>{labels[lang].rosterView}</div>
              <button className="btn modal-close-btn" onClick={() => setRosterViewer(null)}>{"X"}</button>
            </div>
            <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "flex", justifyContent: "center" }}>
              <img src={rosterViewer.src} alt="roster" style={{ width: "100%", height: "auto", maxHeight: "70vh", objectFit: "contain", transform: `scale(${rosterViewer.scale})`, transformOrigin: "center top" }} />
            </div>
            <div className="modal-actions" style={{ marginTop: 8 }} />
          </div>
        </div>
      )}

      {/* roster remove confirm modal */}
      {rosterConfirm && (
        <div className="modal-backdrop" onClick={() => setRosterConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        
            <div style={{ marginBottom: 12 }}>{labels[lang].rosterRemoveConfirm}</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setRosterConfirm(null)}>{labels[lang].cancel}</button>
              <button className="btn danger" onClick={() => { clearRosterImage(rosterConfirm.mode, rosterConfirm.key); setRosterConfirm(null); }}>{labels[lang].rosterRemoveOk}</button>
            </div>
          </div>
        </div>
      )}

      {/* notification */}
      {notification && <div className="notification" role="status" onClick={() => setNotification("")}>{notification}</div>}

      {/* clear confirm modal (in-app) */}
      {showClearConfirm && (
        <div className="modal-backdrop" onClick={() => setShowClearConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div>{labels[lang].confirmClearTitle}</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowClearConfirm(false)}>{labels[lang].cancel}</button>
              <button className="btn danger" onClick={confirmClearAll}>{labels[lang].okClear}</button>
            </div>
          </div>
        </div>
      )}

      {/* reset month confirm modal */}
      {showResetConfirm && (
        <div className="modal-backdrop" onClick={() => setShowResetConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div>{labels[lang].confirmResetTitle}</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowResetConfirm(false)}>{labels[lang].cancel}</button>
              <button className="btn warn" onClick={confirmResetMonth}>{labels[lang].okReset}</button>
            </div>
          </div>
        </div>
      )}

      <div className="disclaimer">
        {labels[lang].disclaimerLine1}
        <br />
        {labels[lang].disclaimerLine2}
        <br />
        <a href="https://lauming1111.github.io/resume/" target="_blank" rel="noreferrer">https://lauming1111.github.io/resume/</a>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
          <img src={ram} style={{ width: "40%", height: "40%", marginLeft: 4, marginTop: 3, verticalAlign: "middle" }} />
        </div>
      </div>

    </div>
  );
}

const BIWEEK_COLORS = [
  "#e3f2fd", // light blue
  "#fce4ec", // light pink
  "#e8f5e9", // light green
  "#fff3e0", // light orange
  "#f3e5f5", // light purple
  "#f9fbe7", // light lime
];

function getTorontoToday(): Date {
  // Get Toronto date parts
  const now = new Date();
  const torontoParts = now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).split("-");
  // Build a Date object for midnight Toronto time
  return new Date(`${torontoParts[0]}-${torontoParts[1]}-${torontoParts[2]}T00:00:00-04:00`);
}

function CustomTimeInput({
  value,
  onChange,
  label,
}: {
  value: string | null | undefined;
  onChange: (val: string) => void;
  label: string;
}) {
  const [hour, setHour] = useState<string>(() => value?.split(":")[0] ?? "");
  const [minute, setMinute] = useState<string>(() => value?.split(":")[1] ?? "");

  useEffect(() => {
    if (value) {
      const [h, m] = value.split(":");
      setHour(h);
      setMinute(m);
    }
  }, [value]);

  const handleHour = (e: React.ChangeEvent<HTMLInputElement>) => {
    let h = e.target.value.replace(/\D/g, "");
    if (h.length > 2) h = h.slice(0, 2);
    if (h && (+h < 0 || +h > 23)) return;
    setHour(h);
    // Only pad when saving to state, not when typing
    if (minute !== "") {
      onChange(`${h.padStart(2, "0")}:${minute.padStart(2, "0")}`);
    } else {
      onChange("");
    }
  };

  const handleMinute = (e: React.ChangeEvent<HTMLInputElement>) => {
    let m = e.target.value.replace(/\D/g, "");
    if (m.length > 2) m = m.slice(0, 2);
    if (m && (+m < 0 || +m > 59)) return;
    setMinute(m);
    // Only pad when saving to state, not when typing
    if (hour !== "") {
      onChange(`${hour.padStart(2, "0")}:${m.padStart(2, "0")}`);
    } else {
      onChange("");
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        type="number"
        min={0}
        max={23}
        value={hour}
        onChange={handleHour}
        placeholder={label ? `${label} HH` : "HH"}
        style={{ width: 40, fontSize: 16 }}
      />
      :
      <input
        type="number"
        min={0}
        max={59}
        value={minute}
        onChange={handleMinute}
        placeholder="MM"
        style={{ width: 40, fontSize: 16 }}
      />
    </div>
  );
}

