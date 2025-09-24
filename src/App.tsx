import React, { JSX, useEffect, useMemo, useState } from "react";
import "./App.css";

/* ---------------------- Types ---------------------- */
type Item = {
  id: number;
  name: string;
  price: number;
  taxable: boolean;
  enabled: boolean;
};

type DayHours = {
  date: string; // "YYYY-MM-DD"
  hours: number | null;
};

type DetailedDay = {
  date: string;
  hours: number;
  earnings: number; // gross
  taxPaid: number;
  afterTax: number;
};

/* -------------------- Constants -------------------- */
const INCOME_TAX_RATE = 0.13;
const WEEKLY_OT_THRESHOLD = 44;
const BIWEEKLY_TAXFREE_THRESHOLD = 80;

const defaultItems: Item[] = [
  { id: 1, name: "Rent", price: 0, taxable: false, enabled: true },
  { id: 2, name: "Food / Groceries", price: 0, taxable: true, enabled: true },
  { id: 3, name: "Transportation", price: 0, taxable: true, enabled: true },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/* ---------------------- App ------------------------ */
export default function App(): JSX.Element {
  // persisted state
  const [items, setItems] = useState<Item[]>(
    () => JSON.parse(localStorage.getItem("w2b_items") || "null") || defaultItems
  );
  const [hourlyRate, setHourlyRate] = useState<number>(
    () => Number(localStorage.getItem("w2b_hourlyRate") || "17.2")
  );
  const [dayHours, setDayHours] = useState<DayHours[]>(
    () => JSON.parse(localStorage.getItem("w2b_history") || "null") || []
  );
  const [startDate, setStartDate] = useState<string>(
    () => localStorage.getItem("w2b_startDate") || ymd(new Date())
  );
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const s = localStorage.getItem("w2b_currentDate");
    return s ? new Date(s) : new Date();
  });
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const v = localStorage.getItem("w2b_dark");
    return v ? v === "1" : false;
  });

  // UI transient
  const [notification, setNotification] = useState<string>("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // persist on change
  useEffect(() => localStorage.setItem("w2b_items", JSON.stringify(items)), [items]);
  useEffect(() => localStorage.setItem("w2b_hourlyRate", String(hourlyRate)), [hourlyRate]);
  useEffect(() => localStorage.setItem("w2b_history", JSON.stringify(dayHours)), [dayHours]);
  useEffect(() => localStorage.setItem("w2b_startDate", startDate), [startDate]);
  useEffect(() => localStorage.setItem("w2b_currentDate", currentDate.toISOString()), [currentDate]);
  useEffect(() => localStorage.setItem("w2b_dark", darkMode ? "1" : "0"), [darkMode]);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 3000);
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
    const entries = dayHours.filter(d => d.hours !== null && !isNaN(d.hours!)) as { date: string; hours: number }[];
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
        results.push({ date: r.date, hours: 0, earnings: 0, taxPaid: 0, afterTax: 0 });
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

      const earnings = h * hourlyRate;
      const taxableHours = Math.max(0, h - dayTaxFree);
      const taxableEarnings = taxableHours * hourlyRate;
      const taxPaid = round2(taxableEarnings * INCOME_TAX_RATE);
      const afterTax = round2(earnings - taxPaid);

      results.push({
        date: r.date,
        hours: h,
        earnings: round2(earnings),
        taxPaid,
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
    const map = new Map<number, { hours: number; earned: number; days: { date: string; hours: number; earnings: number }[] }>();
    detailedHistory.forEach(d => {
      const { biWeekIndex } = getIndexInfo(d.date);
      const cur = map.get(biWeekIndex) || { hours: 0, earned: 0, days: [] };
      cur.hours += d.hours;
      cur.earned += d.earnings;
      cur.days.push({ date: d.date, hours: d.hours, earnings: d.earnings });
      map.set(biWeekIndex, cur);
    });

    // Calculate tax for each period as a whole
    return Array.from(map.entries()).map(([idx, val]) => {
      // Cap taxable hours at BIWEEKLY_TAXFREE_THRESHOLD
      const taxableHours = Math.min(val.hours, BIWEEKLY_TAXFREE_THRESHOLD);
      const taxableEarnings = taxableHours * hourlyRate;
      const tax = round2(taxableEarnings * INCOME_TAX_RATE);
      return {
        index: idx + 1,
        hours: val.hours,
        earned: val.earned,
        tax,
      };
    });
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
      return [...other, { date, hours: n }];
    });
  };

  const resetMonthHours = () => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    const prefix = `${y}-${m}-`;
    setDayHours(prev => prev.filter(h => !h.date.startsWith(prefix)));
    notify("This month's hours reset");
  };

  const autoFillWeekdays = () => {
    const val = prompt("Auto-fill weekdays hours (Mon-Fri) for this month:", "8");
    if (val === null) return;
    const h = Number(val || "8");
    if (isNaN(h) || h < 0 || h > 24) { notify("Invalid hour"); return; }
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
    notify("Weekdays auto-filled");
  };

  const addItem = () => setItems(prev => [...prev, { id: Date.now(), name: `Item ${prev.length + 1}`, price: 0, taxable: true, enabled: true }]);
  const removeItem = (id: number) => setItems(prev => prev.filter(i => i.id !== id));

  // navigation
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  // export / import JSON
  const exportData = () => {
    const out = {
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
    notify("Exported JSON");
  };

  const handleImportFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(String(e.target?.result || ""));
        if (parsed.items) setItems(parsed.items);
        if (parsed.hourlyRate) setHourlyRate(Number(parsed.hourlyRate));
        if (parsed.startDate) setStartDate(parsed.startDate);
        if (parsed.dayHours) setDayHours(parsed.dayHours);
        notify("Imported data");
      } catch (err) {
        notify("Invalid import file");
      }
    };
    reader.readAsText(file);
    ev.currentTarget.value = "";
  };

  const saveAll = () => {
    localStorage.setItem("w2b_items", JSON.stringify(items));
    localStorage.setItem("w2b_hourlyRate", String(hourlyRate));
    localStorage.setItem("w2b_history", JSON.stringify(dayHours));
    localStorage.setItem("w2b_startDate", startDate);
    localStorage.setItem("w2b_dark", darkMode ? "1" : "0");
    notify("Saved");
  };

  const clearAll = () => setShowClearConfirm(true);
  const confirmClearAll = () => {
    setItems(defaultItems);
    setDayHours([]);
    setHourlyRate(17.2);
    setStartDate(ymd(new Date()));
    setDarkMode(false);
    localStorage.clear();
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
  const todayStr = ymd(new Date());

  /* quick map for lookup */
  const detailedMap = useMemo(() => {
    const m = new Map<string, DetailedDay>();
    detailedHistory.forEach(d => m.set(d.date, d));
    return m;
  }, [detailedHistory]);

  /* ---------------------- UI ---------------------- */
  return (
    <div className={`big-container ${darkMode ? "dark" : "light"}`}>
      {/* header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="title-blob">Work-to-Buy Planner</h1>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -6 }}>Plan hours to buy your items</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn small" onClick={() => { setDarkMode(d => !d); notify(darkMode ? "Light mode" : "Dark mode"); }}>
            {darkMode ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </header>

      {/* Information */}
      <div className="card info-card">
        <h2>Information</h2>
        <div className="info-grid">
          <div className="info-item">
            <div className="label">Total Earned After Tax</div>
            <div className="value">${totalEarnedAfterTax.toFixed(2)}</div>
          </div>
          <div className="info-item">
            <div className="label">Total Item Price After Tax</div>
            <div className="value">${totalAfterTaxItemPrice.toFixed(2)}</div>
          </div>
          <div className="info-item">
            <div className="label">Total Item Tax</div>
            <div className="value">${totalItemTax.toFixed(2)}</div>
          </div>
        </div>
        <div className="progress-row">
          <div className="progress-label">Total Progress</div>
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
            <label className="small-label">Hourly Rate</label>
            <input className="control-input" type="number" value={hourlyRate} onChange={e => setHourlyRate(Number(e.target.value))} />
          </div>

          <div>
            <label className="small-label">Start Date</label>
            <input className="control-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          <div style={{ marginTop: 25, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={autoFillWeekdays}>Auto-fill Weekdays</button>
            <button className="btn warn" onClick={resetMonthHours}>Reset Month Hours</button>
            <button className="btn success" onClick={saveAll}>Save</button>
            <button className="btn danger" onClick={() => setShowClearConfirm(true)}>Clear All</button>
          </div>
        </div>

      </div>

      {/* Items */}
      <div className="card">
        <h3>Item List</h3>
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
          <button className="btn primary" onClick={addItem}>+ Add Item</button>
        </div>
      </div>

      {/* Calendar + Bi-weekly summary (Prev/Month/Next on top of calendar) */}
      <div className="calendar-summary-wrap" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="card calendar-card" style={{ flex: 1, minWidth: 320 }}>
          <div className="calendar-header">
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn small" onClick={prevMonth}>Prev Month</button>
              <div className="month-title">{currentDate.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>

              <button className="btn small" onClick={nextMonth}>Next Month</button>
            </div>
            <div style={{ width: 120 }} />
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

              return (
                <div key={idx} className={`cal-cell ${isToday ? "today" : ""} ${isStart ? "start" : ""}`}>
                  <div className="cal-daynum">{dayNum}</div>

                  <input
                    className="cal-input"
                    type="number"
                    min={0}
                    max={24}
                    placeholder="hrs"
                    value={rawEntry?.hours ?? ""}
                    onChange={e => handleHourInput(dateStr, e.target.value)}
                  />

                  {/* daily after-tax (if exists) */}
                  <div className="cal-earn">
                    {rec ? `$${rec.afterTax.toFixed(2)}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card biweekly-card" style={{ width: 320, minWidth: 220 }}>
          <h3>Bi-weekly Summary</h3>
          <table className="items-table">
            <thead>
              <tr>
                <th>Period</th><th>Hours</th><th>Earnings</th><th>Tax</th>
              </tr>
            </thead>
            <tbody>
              {biWeeklySummary.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center" }}>No data</td></tr>}
              {biWeeklySummary.map(b => (
                <tr key={b.index}>
                  <td>{b.index}</td>
                  <td>{round2(b.hours)}</td>
                  <td>${round2(b.earned).toFixed(2)}</td>
                  <td>${round2(b.tax).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export / Import / Save / Clear */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={exportData}>Export JSON</button>

        <label className="btn primary">
          Import JSON
          <input type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
        </label>

        <button className="btn" onClick={saveAll}>Quick Save</button>
        <button className="btn danger" onClick={() => setShowClearConfirm(true)}>Clear All</button>
      </div>

      {/* Details / History */}
      <div className="card">
        <h3>Details</h3>
        <div className="details-scroll">
          <table className="details-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Hours</th>
                <th>Earnings</th>
                <th>After Tax</th>
              </tr>
            </thead>
            <tbody>
              {detailedHistory.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center" }}>No records</td>
                </tr>
              )}
              {detailedHistory.map(d => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td>{d.hours}</td>
                  <td>${d.earnings.toFixed(2)}</td>
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
            <div>Clear ALL data (items, hours, settings)?</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="btn danger" onClick={confirmClearAll}>OK, Clear</button>
            </div>
          </div>
        </div>
      )}

      <div className="disclaimer">This website is generated by AI, actual results may vary.</div>
    </div>
  );
}
