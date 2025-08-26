import React, { JSX, useEffect, useMemo, useState } from "react";
import "./App.css";

type Item = {
  id: number;
  name: string;
  price: number;
  taxable: boolean;
  enabled: boolean;
};

type DayRecord = {
  date: string;          // YYYY-MM-DD
  hours: number | null;  // null means empty
  earnings: number;      // computed
  taxPaid: number;       // computed
};

const defaultItems: Item[] = [
  { id: 1, name: "Rent", price: 0, taxable: false, enabled: true },
  { id: 2, name: "Food / Groceries", price: 0, taxable: true, enabled: true },
  { id: 3, name: "Transportation", price: 0, taxable: true, enabled: true },
];

const INCOME_TAX_RATE = 0.13;
const WEEKLY_OT_THRESHOLD = 44;
const BIWEEKLY_TAXFREE_THRESHOLD = 80;

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export default function App(): JSX.Element {
  // --- persisted state
  const [items, setItems] = useState<Item[]>(
    () => JSON.parse(localStorage.getItem("w2b_items") || "null") || defaultItems
  );
  const [hourlyRate, setHourlyRate] = useState<number>(
    () => Number(localStorage.getItem("w2b_hourlyRate") || "17.2")
  );
  const [history, setHistory] = useState<DayRecord[]>(
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
    return v ? v === "1" : false; // default light
  });

  // transient UI
  const [notification, setNotification] = useState<string>("");
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  // persist relevant state
  useEffect(() => localStorage.setItem("w2b_items", JSON.stringify(items)), [items]);
  useEffect(() => localStorage.setItem("w2b_hourlyRate", String(hourlyRate)), [hourlyRate]);
  useEffect(() => localStorage.setItem("w2b_history", JSON.stringify(history)), [history]);
  useEffect(() => localStorage.setItem("w2b_startDate", startDate), [startDate]);
  useEffect(() => localStorage.setItem("w2b_currentDate", currentDate.toISOString()), [currentDate]);
  useEffect(() => localStorage.setItem("w2b_dark", darkMode ? "1" : "0"), [darkMode]);

  const notify = (msg: string) => {
    setNotification(msg);
    const t = setTimeout(() => setNotification(""), 3000);
    return () => clearTimeout(t);
  };

  // --- items helpers
  const handleItemChange = (id: number, field: keyof Item, value: string | boolean) => {
    setItems(prev =>
      prev.map(it =>
        it.id === id
          ? {
            ...it,
            [field]:
              field === "price" ? Number(value) : field === "enabled" || field === "taxable" ? Boolean(value) : value,
          }
          : it
      )
    );
  };
  const addItem = () => {
    setItems(prev => [...prev, { id: Date.now(), name: `Item ${prev.length + 1}`, price: 0, taxable: true, enabled: true }]);
  };
  const removeItem = (id: number) => setItems(prev => prev.filter(i => i.id !== id));

  // --- calendar helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth(); // 0-11
  const startOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = startOfMonth.getDay(); // 0..6
  const totalCells = firstWeekday + daysInMonth;
  const rows = Math.ceil(totalCells / 7);
  const totalGrid = rows * 7;
  const todayStr = ymd(new Date());

  const getDayRecord = (dateStr: string) => history.find(h => h.date === dateStr) || null;

  const handleHourInput = (date: string, hours: string) => {
    let h: number | null = hours === "" ? null : Number(hours);
    if (h !== null) {
      if (isNaN(h)) h = null;
      else h = Math.max(0, Math.min(24, h));
    }
    setHistory(prev => {
      const filtered = prev.filter(x => x.date !== date);
      if (h === null) return filtered;
      return [...filtered, { date, hours: h, earnings: 0, taxPaid: 0 }];
    });
  };

  // --- compute earnings & tax applying weekly OT and biweekly taxfree
  const detailedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const start = new Date(startDate);
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

    const indexInfo = (d: string) => {
      const dt = new Date(d);
      const diffDays = Math.floor((dt.getTime() - start.getTime()) / (1000 * 3600 * 24));
      return {
        weekIndex: Math.floor(diffDays / 7),
        biWeekIndex: Math.floor(diffDays / 14),
        diffDays,
      };
    };

    // weekly and biweekly totals precomputed
    const weeklyTotals = new Map<number, number>();
    const biWeeklyTotals = new Map<number, number>();

    for (const r of sorted) {
      const idx = indexInfo(r.date).weekIndex;
      weeklyTotals.set(idx, (weeklyTotals.get(idx) || 0) + (r.hours || 0));
      const bidx = indexInfo(r.date).biWeekIndex;
      biWeeklyTotals.set(bidx, (biWeeklyTotals.get(bidx) || 0) + (r.hours || 0));
    }

    const results: DayRecord[] = [];

    for (const day of sorted) {
      const h = day.hours || 0;
      if (h <= 0) {
        results.push({ ...day, earnings: 0, taxPaid: 0 });
        continue;
      }
      const { weekIndex, biWeekIndex } = indexInfo(day.date);
      const weekHours = weeklyTotals.get(weekIndex) || 0;
      const biWeekHours = biWeeklyTotals.get(biWeekIndex) || 0;

      // weekly OT (hours beyond threshold)
      const weekOT = Math.max(0, weekHours - WEEKLY_OT_THRESHOLD);
      // prorate OT to the day based on day share
      let dayOT = 0;
      let dayReg = h;
      if (weekHours > 0 && weekOT > 0) {
        const dayShare = h / weekHours;
        dayOT = round2(weekOT * dayShare);
        dayReg = Math.max(0, round2(h - dayOT));
      }

      // bi-weekly tax-free hours proportional
      let dayTaxFree = 0;
      if (biWeekHours > BIWEEKLY_TAXFREE_THRESHOLD && biWeekHours > 0) {
        const extra = biWeekHours - BIWEEKLY_TAXFREE_THRESHOLD;
        dayTaxFree = round2((h / biWeekHours) * extra);
        dayTaxFree = Math.min(dayTaxFree, h);
      }

      // proportionally remove tax-free from reg & OT
      const totalDayHours = Math.max(1e-9, dayReg + dayOT);
      const taxFreeReg = round2(dayTaxFree * (dayReg / totalDayHours));
      const taxFreeOT = round2(dayTaxFree * (dayOT / totalDayHours));

      const taxableReg = Math.max(0, dayReg - taxFreeReg);
      const taxableOT = Math.max(0, dayOT - taxFreeOT);

      // earnings
      const earnings = dayReg * hourlyRate + dayOT * hourlyRate * 1.5;

      // taxable earnings for income tax
      const taxableEarnings = taxableReg * hourlyRate + taxableOT * hourlyRate * 1.5;

      const taxPaid = round2(taxableEarnings * INCOME_TAX_RATE);

      results.push({ date: day.date, hours: h, earnings: round2(earnings), taxPaid });
    }

    return results;
  }, [history, hourlyRate, startDate]);

  // totals and progress
  const totalEarnedAfterTax = useMemo(
    () => round2(detailedHistory.reduce((s, d) => s + (d.earnings - d.taxPaid), 0)),
    [detailedHistory]
  );

  const totalItemPrice = useMemo(() => items.filter(i => i.enabled).reduce((s, i) => s + (i.price || 0), 0), [items]);
  const totalItemTax = useMemo(() => items.filter(i => i.enabled && i.taxable).reduce((s, i) => s + (i.price || 0) * INCOME_TAX_RATE, 0), [items]);
  const totalAfterTaxItemPrice = useMemo(() => round2(totalItemPrice + totalItemTax), [totalItemPrice, totalItemTax]);

  const progressPct = useMemo(() => (totalAfterTaxItemPrice > 0 ? Math.min(100, round2((totalEarnedAfterTax / totalAfterTaxItemPrice) * 100)) : 0), [totalAfterTaxItemPrice, totalEarnedAfterTax]);

  // actions
  const resetMonthHours = () => {
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    setHistory(prev => prev.filter(h => !h.date.startsWith(prefix)));
    notify("Month hours reset");
  };

  const saveAll = () => {
    localStorage.setItem("w2b_items", JSON.stringify(items));
    localStorage.setItem("w2b_hourlyRate", String(hourlyRate));
    localStorage.setItem("w2b_history", JSON.stringify(history));
    localStorage.setItem("w2b_startDate", startDate);
    localStorage.setItem("w2b_dark", darkMode ? "1" : "0");
    notify("Saved");
  };

  const clearAll = () => {
    // confirm modal shown via confirmClear toggle
    setConfirmClear(true);
  };

  const confirmClearNow = () => {
    setItems(defaultItems);
    setHistory([]);
    setHourlyRate(17.2);
    setStartDate(ymd(new Date()));
    setDarkMode(false);
    localStorage.clear();
    setConfirmClear(false);
    notify("All cleared");
  };

  const autoFillWeekdays = () => {
    const input = prompt("Auto-fill weekdays hours for this month (leave blank for 8):", "8");
    if (input === null) return;
    const h = Number(input || "8");
    if (isNaN(h) || h < 0 || h > 24) {
      notify("Invalid hours");
      return;
    }
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const newEntries: DayRecord[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${prefix}${String(d).padStart(2, "0")}`;
      const dt = new Date(year, month, d);
      const wk = dt.getDay();
      if (wk !== 0 && wk !== 6) newEntries.push({ date: dateStr, hours: h, earnings: 0, taxPaid: 0 });
    }
    setHistory(prev => {
      const filtered = prev.filter(r => !r.date.startsWith(prefix));
      return [...filtered, ...newEntries];
    });
    notify("Auto-filled weekdays");
  };

  // UI helpers to render grid
  return (
    <div className={`big-container ${darkMode ? "dark" : "light"}`}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="title-blob">Work-to-Buy Planner</h1>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -8 }}>Plan hours to buy your items</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn small" onClick={() => { setDarkMode(!darkMode); notify(darkMode ? "Light mode" : "Dark mode"); }}>
            {darkMode ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </header>

      {/* Information on top */}
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

      {/* Controls (items & settings) */}
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

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setCurrentDate(new Date(year, month - 1, 1))}>Prev Month</button>
            <div className="month-title">{currentDate.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
            <button className="btn" onClick={() => setCurrentDate(new Date(year, month + 1, 1))}>Next Month</button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={autoFillWeekdays}>Auto-fill Weekdays</button>
          <button className="btn warn" onClick={resetMonthHours}>Reset Month Hours</button>
          <button className="btn success" onClick={saveAll}>Save</button>
          <button className="btn danger" onClick={clearAll}>Clear All</button>
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
                <th style={{ width: 120 }}>Price</th>
                <th style={{ width: 100 }}>Taxable</th>
                <th style={{ width: 90 }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>
                    <input type="checkbox" checked={it.enabled} onChange={e => handleItemChange(it.id, "enabled", e.target.checked)} />
                  </td>
                  <td><input className="item-name" value={it.name} onChange={e => handleItemChange(it.id, "name", e.target.value)} /></td>
                  <td><input type="number" value={it.price} onChange={e => handleItemChange(it.id, "price", e.target.value)} /></td>
                  <td><input type="checkbox" checked={it.taxable} onChange={e => handleItemChange(it.id, "taxable", e.target.checked)} /></td>
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

      {/* Calendar */}
      <div className="card">
        <div className="cal-head grid-7">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => <div key={d} className="cal-head-cell">{d}</div>)}
        </div>

        <div className="cal-grid grid-7">
          {Array.from({ length: totalGrid }).map((_, idx) => {
            const dayNum = idx - firstWeekday + 1;
            const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
            if (!inMonth) return <div key={idx} className="cal-cell empty" />;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const rec = getDayRecord(dateStr);
            const isToday = dateStr === todayStr;
            const isStart = dateStr === startDate;
            return (
              <div key={idx} className={`cal-cell ${isToday ? "today" : ""} ${isStart ? "start" : ""}`}>
                <div className="cal-daynum">{dayNum}</div>
                <input className="cal-input" type="number" placeholder="hrs" value={rec?.hours ?? ""} onChange={e => handleHourInput(dateStr, e.target.value)} />
                <div className="cal-earn">{rec?.earnings ? `$${rec.earnings.toFixed(2)}` : ""}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Details */}
      <div className="card">
        <h3>Details</h3>
        <div className="details-scroll">
          <table className="details-table">
            <thead>
              <tr>
                <th>Date</th><th>Hours</th><th>Earnings</th><th>Tax Paid</th><th>% of Total Items</th>
              </tr>
            </thead>
            <tbody>
              {detailedHistory.map(h => {
                const pct = totalAfterTaxItemPrice > 0 ? round2((h.earnings - h.taxPaid) / totalAfterTaxItemPrice * 100) : 0;
                return (
                  <tr key={h.date}>
                    <td>{h.date}</td>
                    <td>{h.hours ?? ""}</td>
                    <td>${h.earnings.toFixed(2)}</td>
                    <td>${h.taxPaid.toFixed(2)}</td>
                    <td>{pct.toFixed(2)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn" onClick={() => saveAll()}>Quick Save</button>
      </div>

      {/* notification */}
      {notification && <div className="notification" role="status" onClick={() => setNotification("")}>{notification}</div>}

      {/* confirm clear */}
      {confirmClear && (
        <div className="modal-backdrop" onClick={() => setConfirmClear(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-msg">Clear ALL data (items, hours, settings)?</div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn danger" onClick={confirmClearNow}>OK</button>
            </div>
          </div>
        </div>
      )}

      <p className="disclaimer">This website is generated by AI, actual results may vary.</p>
    </div>
  );
}
