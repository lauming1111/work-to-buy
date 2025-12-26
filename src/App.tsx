import React, { JSX, useEffect, useMemo, useState } from "react";
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

type DayHours = {
  date: string; // "YYYY-MM-DD"
  start?: string | null; // "HH:MM"
  end?: string | null;   // "HH:MM"
  hours?: number | null; // calculated, not user input
  lunch?: boolean;       // lunch checkbox state, default true
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
};

/* -------------------- Constants -------------------- */
const INCOME_TAX_RATE = 0.117;
const EMPLOYEE_INSURANCE_RATE = 0.0164;
const CPP_RATE = 0.05482;
const BIWEEKLY_TAXFREE_THRESHOLD = 88;
const BIWEEKLY_BONUS_RATE = 0.08; // 8% bonus per cycle

const defaultItems: Item[] = [
  { id: 1, name: "Rent", price: 0, taxable: false, enabled: true },
  { id: 2, name: "Food / Groceries", price: 0, taxable: true, enabled: true },
  { id: 3, name: "Transportation", price: 0, taxable: true, enabled: true },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

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

const cloneDefaultItems = () => defaultItems.map(item => ({ ...item }));

const createDefaultJobData = () => ({
  items: cloneDefaultItems(),
  hourlyRate: 17.2,
  dayHours: [] as DayHours[],
  startDate: ymd(getTorontoToday()),
  currentDate: getTorontoToday(),
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
  return { items, hourlyRate, dayHours, startDate, currentDate };
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
  // persist on change
  useEffect(() => localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs)), [jobs]);
  useEffect(() => localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, activeJobId), [activeJobId]);
  useEffect(() => localStorage.setItem(jobStorageKey(activeJobId, "items"), JSON.stringify(items)), [items, activeJobId]);
  useEffect(() => localStorage.setItem(jobStorageKey(activeJobId, "hourlyRate"), String(hourlyRate)), [hourlyRate, activeJobId]);
  useEffect(() => localStorage.setItem(jobStorageKey(activeJobId, "dayHours"), JSON.stringify(dayHours)), [dayHours, activeJobId]);
  useEffect(() => localStorage.setItem(jobStorageKey(activeJobId, "startDate"), startDate), [startDate, activeJobId]);
  useEffect(() => localStorage.setItem(jobStorageKey(activeJobId, "currentDate"), currentDate.toISOString()), [currentDate, activeJobId]);
  useEffect(() => localStorage.setItem("w2b_dark", darkMode ? "1" : "0"), [darkMode]);

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

  const persistJobData = (jobId: string) => {
    localStorage.setItem(jobStorageKey(jobId, "items"), JSON.stringify(items));
    localStorage.setItem(jobStorageKey(jobId, "hourlyRate"), String(hourlyRate));
    localStorage.setItem(jobStorageKey(jobId, "dayHours"), JSON.stringify(dayHours));
    localStorage.setItem(jobStorageKey(jobId, "startDate"), startDate);
    localStorage.setItem(jobStorageKey(jobId, "currentDate"), currentDate.toISOString());
  };

  const switchJob = (jobId: string) => {
    if (jobId === activeJobId) return;
    persistJobData(activeJobId);
    const data = loadJobData(jobId);
    setItems(data.items);
    setHourlyRate(data.hourlyRate);
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
      setDayHours(data.dayHours);
      setStartDate(data.startDate);
      setCurrentDate(data.currentDate);
      setActiveJobId(nextActive);
    }
    notify(labels[lang].removedJob);
  };

  /* ---------------- helper indices ---------------- */
  const getIndexInfo = (dateStr: string, baseStart = startDate) => {
    const start = new Date(baseStart);
    const dt = new Date(dateStr);
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

    const weeklyTotals = new Map<number, number>();
    const biWeeklyTotals = new Map<number, number>();
    for (const r of sorted) {
      const { weekIndex, biWeekIndex } = getIndexInfo(r.date);
      weeklyTotals.set(weekIndex, (weeklyTotals.get(weekIndex) || 0) + (r.hours || 0));
      biWeeklyTotals.set(biWeekIndex, (biWeeklyTotals.get(biWeekIndex) || 0) + (r.hours || 0));
    }

    const results: DetailedDay[] = [];

    for (const r of sorted) {
      const h = r.hours || 0;
      if (h <= 0) {
        results.push({ date: r.date, hours: 0, earnings: 0, incomeTax: 0, employeeInsurance: 0, cpp: 0, afterTax: 0 });
        continue;
      }

      const { biWeekIndex } = getIndexInfo(r.date);
      const biWeekHours = biWeeklyTotals.get(biWeekIndex) || 0;

      // Calculate tax-free hours for this day
      let dayTaxFree = 0;
      if (biWeekHours > BIWEEKLY_TAXFREE_THRESHOLD && biWeekHours > 0) {
        const extra = biWeekHours - BIWEEKLY_TAXFREE_THRESHOLD;
        dayTaxFree = round2((h / biWeekHours) * extra);
        dayTaxFree = Math.min(dayTaxFree, h);
      }

      // 8% bonus for all hours in this bi-week
      const bonusMultiplier = 1 + BIWEEKLY_BONUS_RATE;
      const earnings = h * hourlyRate * bonusMultiplier;

      const taxableHours = Math.max(0, h - dayTaxFree);
      const taxableEarnings = taxableHours * hourlyRate * bonusMultiplier;

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
  }, [dayHours, hourlyRate, startDate]);

  /* ---------------- summaries ---------------- */
  const totalEarnedAfterTax = useMemo(() => round2(detailedHistory.reduce((s, d) => s + d.afterTax, 0)), [detailedHistory]);
  const totalItemPrice = useMemo(() => items.filter(i => i.enabled).reduce((s, i) => s + (i.price || 0), 0), [items]);
  const totalItemTax = useMemo(() => items.filter(i => i.enabled && i.taxable).reduce((s, i) => s + (i.price || 0) * INCOME_TAX_RATE, 0), [items]);
  const totalAfterTaxItemPrice = useMemo(() => round2(totalItemPrice + totalItemTax), [totalItemPrice, totalItemTax]);
  const progressPct = useMemo(() => (totalAfterTaxItemPrice > 0 ? Math.min(100, round2((totalEarnedAfterTax / totalAfterTaxItemPrice) * 100)) : 0), [totalAfterTaxItemPrice, totalEarnedAfterTax]);

  // bi-weekly summary (hours / earnings / tax)
  const biWeeklySummary = useMemo(() => {
    // Group all entries by biWeekIndex
    const map = new Map<number, { hours: number; earned: number; days: { date: string; hours: number; earnings: number; }[]; }>();
    detailedHistory.forEach(d => {
      const { biWeekIndex } = getIndexInfo(d.date);
      const cur = map.get(biWeekIndex) || { hours: 0, earned: 0, days: [] };
      cur.hours += d.hours;
      cur.earned += d.earnings;
      cur.days.push({ date: d.date, hours: d.hours, earnings: d.earnings });
      map.set(biWeekIndex, cur);
    });

    return Array.from(map.entries()).map(([idx, val]) => ({
      index: idx + 1,
      hours: val.hours,
      earned: val.earned,
      days: val.days,
    }));
  }, [detailedHistory, hourlyRate, startDate]);

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
      const lunch = existing?.lunch ?? true;
      // Always store the original entered hours
      const originalHours = n;
      const hours = lunch ? Math.max(0, n - 0.5) : n;
      return [
        ...other,
        {
          date,
          hours,
          lunch,
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
      const lunch = existing.lunch ?? true;
      const updated = { ...existing, [field]: value?.format("HH:mm"), lunch };

      let hours: number | null = null;
      if (updated.start && updated.end) {
        const [sh, sm] = updated.start.split(":").map(Number);
        const [eh, em] = updated.end.split(":").map(Number);
        const startMins = sh * 60 + sm;
        let endMins = eh * 60 + em;
        if (lunch) endMins -= 30; // subtract 30 mins if lunch is true
        hours = (endMins - startMins) / 60;
        if (hours < 0 || hours > 24) hours = null;
      }
      return [...other, { ...updated, hours }];
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
    return { items, hourlyRate, dayHours, startDate, currentDate };
  };

  const buildJobExport = (jobId: string): JobExport => {
    const data = jobId === activeJobId
      ? { items, hourlyRate, dayHours, startDate, currentDate }
      : loadJobData(jobId);
    return {
      items: data.items,
      hourlyRate: data.hourlyRate,
      dayHours: data.dayHours,
      startDate: data.startDate,
      currentDate: data.currentDate.toISOString(),
    };
  };

  const exportData = () => {
    const out = {
      jobName: activeJob?.name,
      items,
      hourlyRate,
      startDate,
      dayHours,
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
      localStorage.setItem(jobStorageKey(job.id, "items"), JSON.stringify(normalized.items));
      localStorage.setItem(jobStorageKey(job.id, "hourlyRate"), String(normalized.hourlyRate));
      localStorage.setItem(jobStorageKey(job.id, "dayHours"), JSON.stringify(normalized.dayHours));
      localStorage.setItem(jobStorageKey(job.id, "startDate"), normalized.startDate);
      localStorage.setItem(jobStorageKey(job.id, "currentDate"), normalized.currentDate.toISOString());
    });

    const nextActive = typeof payload.activeJobId === "string" && nextJobs.some(job => job.id === payload.activeJobId)
      ? payload.activeJobId
      : nextJobs[0].id;
    const activeData = normalizeJobData(jobDataMap[nextActive]);

    setJobs(nextJobs);
    setActiveJobId(nextActive);
    setItems(activeData.items);
    setHourlyRate(activeData.hourlyRate);
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
    localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs));
    localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, activeJobId);
    localStorage.setItem("w2b_dark", darkMode ? "1" : "0");
    notify("Saved");
  };

  const clearAll = () => setShowClearConfirm(true);
  const confirmClearAll = () => {
    clearJobStorage(activeJobId);
    setItems(cloneDefaultItems());
    setDayHours([]);
    setHourlyRate(17.2);
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
      export: "Export Data",
      exportAll: "Export All Jobs",
      import: "Import Data",
      job: "Job",
      removeJob: "Remove Job",
      quickSave: "Quick Save",
      details: "Details",
      noRecords: "No records",
      subtractLunchDesc: "Subtract 30 min from worked hours when ON",
      lunchOn: "Lunch",
      lunchOff: "No Lunch",
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
      export: "匯出資料",
      exportAll: "Export All Jobs",
      job: "Job",
      removeJob: "Remove Job",
      import: "匯入資料",
      quickSave: "快速儲存",
      details: "明細",
      noRecords: "無紀錄",
      subtractLunchDesc: "啟用後會從工時中扣除 30 分鐘午休",
      lunchOn: "午休",
      lunchOff: "沒有午休",
      resetHours: "重設工時",
      prevMonth: "上個月",
      nextMonth: "下個月",
      imported: "已匯入資料",
      importedAll: "Imported all jobs",
      invalidImport: "匯入檔案格式錯誤",
      exported: "已匯出 JSON",
      exportedAll: "Exported all jobs",
      confirmRemoveJob: "Remove job",
      removedJob: "Removed job",
      cannotRemoveLastJob: "At least one job must remain",
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Language Switch Button */}
          <button
            className="btn small"
            onClick={() => setLang(lang === "en" ? "zh-tw" : "en")}
            style={{ minWidth: 60 }}
          >
            {labels[lang].switch}
          </button>
          <button className="btn small" onClick={() => { setDarkMode(d => !d); notify(darkMode ? labels[lang].lightMode : labels[lang].darkMode); }}>
            {darkMode ? `☀️ ${labels[lang].lightMode}` : `🌙 ${labels[lang].darkMode}`}
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
                <th style={{ width: 36 }}></th>
                <th>Name</th>
                <th style={{ width: 140 }}>Price</th>
                <th style={{ width: 120 }}>Taxable</th>
                <th style={{ width: 80 }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>
                    <input type="checkbox" checked={it.enabled} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, enabled: e.target.checked } : p))} />
                  </td>
                  <td><input className="item-name" value={it.name} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, name: e.target.value } : p))} /></td>
                  <td><input type="number" value={it.price} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, price: Number(e.target.value) } : p))} /></td>
                  <td><input type="checkbox" checked={it.taxable} onChange={e => setItems(prev => prev.map(p => p.id === it.id ? { ...p, taxable: e.target.checked } : p))} /></td>
                  <td><button className="btn sm danger" onClick={() => removeItem(it.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={addItem}>{labels[lang].addItem}</button>
        </div>
      </div>

      {/* Calendar + Bi-weekly summary (Prev/Month/Next on top of calendar) */}
      <div className="calendar-summary-wrap" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="card calendar-card" style={{ flex: 1, minWidth: 320 }}>
          <div className="calendar-header">
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn small" onClick={prevMonth}>{labels[lang].prevMonth}</button>
              <div className="month-title">{currentDate.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>

              <button className="btn small" onClick={nextMonth}>{labels[lang].nextMonth}</button>
            </div>
          </div>

          <div className="cal-head grid-7">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d} className="cal-head-cell">{d}</div>)}
          </div>

          <div className="cal-grid">
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
              const bgColor = BIWEEK_COLORS[biWeekIndex % BIWEEK_COLORS.length];

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

                  {/* --- NEW: Lunch toggle + description (placed above reset button) --- */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 6 }}>
                    <button
                      className={`btn sm lunch-toggle ${(rawEntry?.lunch ?? true) ? "" : "off"}`}
                      aria-pressed={!!(rawEntry?.lunch ?? true)}
                      onClick={() => {
                        const lunchChecked = !(rawEntry?.lunch ?? true);
                        setDayHours(prev => {
                          const other = prev.filter(p => p.date !== dateStr);
                          const existing = prev.find(p => p.date === dateStr) || { date: dateStr, lunch: true };
                          let originalHours = existing.originalHours ?? existing.hours ?? null;
                          if (existing.hours != null && existing.originalHours == null) originalHours = existing.hours;
                          let updated: DayHours = { ...existing, lunch: lunchChecked, originalHours };

                          if (updated.start && updated.end) {
                            const [sh, sm] = updated.start.split(":").map(Number);
                            const [eh, em] = updated.end.split(":").map(Number);
                            const startMins = sh * 60 + sm;
                            let endMins = eh * 60 + em;
                            let hours = (endMins - startMins) / 60;
                            if (lunchChecked) hours -= 0.5;
                            updated.hours = (hours >= 0 && hours <= 24) ? round2(hours) : null;
                          } else if (originalHours != null && (!updated.start && !updated.end)) {
                            updated.hours = lunchChecked ? Math.max(0, round2(originalHours - 0.5)) : round2(originalHours);
                          }

                          return [...other, updated];
                        });
                      }}
                      title={labels[lang].subtractLunchDesc}
                    >
                      {rawEntry?.lunch ?? true ? labels[lang].lunchOn : labels[lang].lunchOff}
                    </button>

                    <div className="lunch-desc">
                      {labels[lang].subtractLunchDesc}
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

        <div className="card biweekly-card" style={{ width: "100%", minWidth: 220, marginTop: 16 }}>
          <h3>Bi-weekly Summary</h3>
          <table className="items-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Hrs</th>
                <th>Period Date</th>
                <th>Earnings ({"<="}88)</th>
                <th>Earnings ({">"}88)</th>
                <th>Income Tax</th>
                <th>EI</th>
                <th>CPP</th>
                <th>Net ({"<"}88)</th>
                <th>Take-Home Pay</th>
              </tr>
            </thead>
            <tbody>
              {biWeeklySummary.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center" }}>No data</td></tr>}
              {biWeeklySummary.map((b, i) => {
                const periodDays = b.days || [];
                const periodDates = periodDays.length > 0 ? `${periodDays[0].date} ~ ${periodDays[periodDays.length - 1].date}` : "";
                const periodDetails = detailedHistory.filter(d => periodDays.some(day => day.date === d.date));
                const hours = periodDetails.reduce((sum, d) => sum + d.hours, 0);

                // Calculate first 88 hours earnings (+8%) and after deduction
                let taxedHours = 0;
                let earnings88 = 0;
                let cashEarnings = 0;
                for (const d of periodDetails) {
                  const h = d.hours;
                  const bonusMultiplier = 1 + BIWEEKLY_BONUS_RATE;
                  const taxedLeft = Math.max(0, BIWEEKLY_TAXFREE_THRESHOLD - taxedHours);
                  const thisTaxed = Math.min(h, taxedLeft);
                  const thisCash = h - thisTaxed;
                  taxedHours += thisTaxed;
                  earnings88 += thisTaxed * hourlyRate * bonusMultiplier;
                  cashEarnings += thisCash * hourlyRate * bonusMultiplier;
                }
                const totalIncome = earnings88 + cashEarnings;

                // Deductions for first 88 hours only
                const incomeTax88 = round2(earnings88 * INCOME_TAX_RATE);
                const employeeInsurance88 = round2(earnings88 * EMPLOYEE_INSURANCE_RATE);
                const cpp88 = round2(earnings88 * CPP_RATE);
                const afterTax88 = round2(earnings88 - incomeTax88 - employeeInsurance88 - cpp88);

                // Deductions for all hours (for display)
                const incomeTax = periodDetails.reduce((sum, d) => sum + d.incomeTax, 0);
                const employeeInsurance = periodDetails.reduce((sum, d) => sum + d.employeeInsurance, 0);
                const cpp = periodDetails.reduce((sum, d) => sum + d.cpp, 0);

                return (
                  <tr key={b.index}>
                    <td>{b.index}</td>
                    <td>{round2(hours)}</td>
                    <td>{periodDates}</td>
                    <td>${round2(earnings88).toFixed(2)}</td>
                    <td>${round2(cashEarnings).toFixed(2)}</td>
                    <td>${round2(incomeTax88).toFixed(2)}</td>
                    <td>${round2(employeeInsurance88).toFixed(2)}</td>
                    <td>${round2(cpp88).toFixed(2)}</td>
                    <td>${round2(afterTax88).toFixed(2)}</td> {/* Expected Take-Home Pay */}
                    <td>${round2(afterTax88 + cashEarnings).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

      {/* Details / History */}
      <div className="card">
        <h3>{labels[lang].details}</h3>
        <div className="details-scroll">
          <table className="details-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Hours</th>
                <th>Earnings</th>
                <th>Income Tax</th>
                <th>Employee Insurance</th>
                <th>CPP</th>
                <th>After Tax</th>
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
                  <td>{d.date}</td>
                  <td>{d.hours.toFixed(2)}</td>
                  <td>${d.earnings.toFixed(2)}</td>
                  <td>${d.incomeTax.toFixed(2)}</td>
                  <td>${d.employeeInsurance.toFixed(2)}</td>
                  <td>${d.cpp.toFixed(2)}</td>
                  <td>${d.afterTax.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
