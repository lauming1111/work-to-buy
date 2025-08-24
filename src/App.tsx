import React, { useEffect, useMemo, useState } from "react";

function round2(n: number) { return Math.round(n*100)/100; }
function ymd(d: Date) { return d.toISOString().split("T")[0]; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth()+1, 0); }

interface Entry { date: string; hours: number; earnings: number; tax: number; }
interface Item { id: number; name: string; price: number; taxable?: boolean; taxRate?: number; enabled?: boolean; }

const defaultItems: Item[] = [
  { id: 1, name: "Rent", price: 0, taxable: false, taxRate:0, enabled:true },
  { id: 2, name: "Food / Groceries", price: 0, taxable: false, taxRate:0, enabled:true },
  { id: 3, name: "Transportation", price: 0, taxable: false, taxRate:0, enabled:true },
];

export default function WorkToBuyPlanner() {
  const todayStr = ymd(new Date());
  const [hourlyRate, setHourlyRate] = useState(17.2);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [startDate, setStartDate] = useState(todayStr);
  const [notification, setNotification] = useState<{message:string, visible:boolean}>({message:"", visible:false});

  useEffect(() => {
    const savedItems = localStorage.getItem("items");
    if(savedItems) setItems(JSON.parse(savedItems));
    else setItems(defaultItems);

    const savedHistory = localStorage.getItem("history");
    if(savedHistory) setHistory(JSON.parse(savedHistory));
    else setHistory([]);

    const savedStart = localStorage.getItem("startDate");
    if(savedStart) setStartDate(savedStart);

    const savedRate = localStorage.getItem("hourlyRate");
    if(savedRate) setHourlyRate(JSON.parse(savedRate));
  }, []);

  function showNotification(msg:string){
    setNotification({message:msg, visible:true});
    setTimeout(()=>setNotification(prev=>({...prev, visible:false})),3000);
  }

  function estimateIncomeTax(hourlyRate: number, dailyHours: number) {
    const weeksPerYear = 52;
    const projectedAnnual = hourlyRate * dailyHours * weeksPerYear;
    let rate = 0.15;
    if(projectedAnnual <= 53359) rate = 0.15;
    else if(projectedAnnual <= 106717) rate = 0.25;
    else if(projectedAnnual <= 165430) rate = 0.33;
    else rate = 0.45;
    return round2(dailyHours * hourlyRate * rate);
  }

  function updateDay(date:string,hours:number){
    hours = Math.max(0, Math.min(24, hours));
    const earnings = round2(hours*hourlyRate);
    const incomeTax = estimateIncomeTax(hourlyRate, hours);
    setHistory(prev=>{
      const idx = prev.findIndex(e=>e.date===date);
      const newEntry = { date,hours,earnings,tax:incomeTax };
      if(idx>=0){ const copy=[...prev]; copy[idx]=newEntry; return copy; }
      return [...prev,newEntry].sort((a,b)=>a.date.localeCompare(b.date));
    });
  }

  const calendarCells = useMemo(()=>{
    const first = startOfMonth(currentMonth);
    const last = endOfMonth(currentMonth);
    const firstWeekday = first.getDay();
    const map = new Map(history.map(e=>[e.date,e] as const));
    const cells:any[] = [];
    for(let i=0;i<firstWeekday;i++) cells.push({date:null,key:`b${i}`});
    for(let d=1; d<=last.getDate(); d++){
      const dt = new Date(currentMonth.getFullYear(),currentMonth.getMonth(),d);
      const key = ymd(dt);
      const entry = map.get(key) || { date:key, hours:0, earnings:0, tax:0 };
      cells.push({ date:dt, entry, key });
    }
    while(cells.length%7!==0) cells.push({date:null,key:`t${cells.length}`});
    while(cells.length<42) cells.push({date:null,key:`t${cells.length}`});
    return cells;
  },[currentMonth, history]);

  const enabledItems = items.filter(i=>i.enabled);
  const totalItemPrice = enabledItems.reduce((s,i)=>s+i.price,0);
  const totalItemTax = round2(enabledItems.reduce((s,i)=>s + (i.taxable ? i.price*(i.taxRate??0.13) : 0),0));

  const tableData = useMemo(()=>{
    const sorted = history.filter(h=>h.hours>0).sort((a,b)=>a.date.localeCompare(b.date));
    let cumulative = 0;
    return sorted.map(h=>{
      const afterTax = h.earnings - h.tax;
      const dayPercent = totalItemPrice ? round2(afterTax/totalItemPrice*100) : 0;
      cumulative += dayPercent;
      return {...h, cumulative: Math.min(round2(cumulative),100), dayPercent};
    });
  },[history, totalItemPrice]);

  const totalProgress = tableData.length ? Math.min(100, round2(tableData[tableData.length-1].cumulative)) : 0;
  const totalEarned = round2(tableData.reduce((sum,h)=>sum+h.earnings-h.tax,0));

  const averageDailyHours = useMemo(() => {
    const daysWorked = history.filter(h=>h.hours>0);
    if(daysWorked.length === 0) return 0;
    const totalHours = daysWorked.reduce((sum,h)=>sum+h.hours,0);
    return totalHours / daysWorked.length;
  }, [history]);

  const totalAfterTaxItemPrice = enabledItems.reduce((sum,i)=>sum + (i.taxable ? i.price*(1+(i.taxRate??0.13)) : i.price), 0);
  const remainingAmount = Math.max(0, totalAfterTaxItemPrice - totalEarned);
  const estimatedHoursLeft = averageDailyHours > 0 ? round2(remainingAmount / hourlyRate) : 0;
  const estimatedDaysLeft = averageDailyHours > 0 ? round2(estimatedHoursLeft / averageDailyHours) : 0;

  function addItem(){
    const newId = items.length ? Math.max(...items.map(i=>i.id))+1 : 1;
    setItems([...items,{id:newId,name:`Item ${newId}`,price:0, taxable:true, taxRate:0.13, enabled:true}]);
  }
  function removeItem(id:number){ setItems(items.filter(i=>i.id!==id)); }

  function saveAllInputs(){
    const updatedHistory = [...history];
    calendarCells.forEach(cell=>{
      if(cell.entry){
        const idx = updatedHistory.findIndex(h=>h.date===cell.entry.date);
        const earnings = round2(cell.entry.hours*hourlyRate);
        const tax = estimateIncomeTax(hourlyRate, cell.entry.hours);
        const entry = { date:cell.entry.date, hours:cell.entry.hours, earnings, tax };
        if(idx>=0) updatedHistory[idx]=entry;
        else updatedHistory.push(entry);
      }
    });
    setHistory(updatedHistory);
    localStorage.setItem("history", JSON.stringify(updatedHistory));
    localStorage.setItem("items", JSON.stringify(items));
    localStorage.setItem("hourlyRate", JSON.stringify(hourlyRate));
    localStorage.setItem("startDate", startDate);
    showNotification("All inputs saved successfully!");
  }

  function clearAll(){
    if(!window.confirm("Are you sure you want to clear all data?")) return;
    setItems(defaultItems);
    setHistory([]);
    setHourlyRate(17.2);
    setStartDate(todayStr);
    localStorage.removeItem("items");
    localStorage.removeItem("history");
    localStorage.removeItem("hourlyRate");
    localStorage.removeItem("startDate");
    showNotification("All data cleared successfully!");
  }

  function prevMonth(){ setCurrentMonth(new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1)); }
  function nextMonth(){ setCurrentMonth(new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1)); }

  return (
    <div className="min-h-screen p-4 flex justify-center bg-gray-100">
      <div className="w-full max-w-6xl bg-white rounded-2xl p-6 shadow-2xl">
        <h1 className="text-3xl font-bold text-center mb-6 text-indigo-600">Work-to-Buy Planner</h1>

        {notification.visible && (
          <div className="fixed inset-0 flex items-center justify-center z-50">
            <div className="bg-green-50 border border-green-400 text-green-800 rounded-xl p-4 shadow-lg flex flex-col items-center">
              <span className="mb-2">{notification.message}</span>
              <button 
                className="bg-green-500 hover:bg-green-600 text-white px-4 py-1 rounded-md transition"
                onClick={()=>setNotification(prev=>({...prev, visible:false}))}>
                OK
              </button>
            </div>
          </div>
        )}

        {/* Start Date & Hourly Rate */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex gap-2 items-center">
            <label className="font-semibold text-gray-700">Start Date:</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="border rounded-md p-1"/>
          </div>
          <div className="flex gap-2 items-center">
            <label className="font-semibold text-gray-700">Hourly Rate:</label>
            <input type="number" value={hourlyRate} onChange={e=>setHourlyRate(Number(e.target.value))} className="border rounded-md p-1 w-32"/>
          </div>
        </div>

        {/* Item List */}
        <h2 className="text-xl font-semibold mb-2 text-gray-800">Item List</h2>
        <div className="grid grid-cols-6 gap-2 items-center mb-2 font-semibold text-gray-700">
          <div>Enabled</div>
          <div>Name</div>
          <div>Price</div>
          <div className="text-center">Taxable</div>
          <div>Est. Tax</div>
          <div>Remove</div>
        </div>
        <div className="grid grid-cols-6 gap-2 items-center mb-4">
          {items.map(item => (
            <React.Fragment key={item.id}>
              <div className="flex justify-center items-center">
                <input
                  type="checkbox"
                  checked={item.enabled ?? true}
                  onChange={e =>
                    setItems(items.map(i => i.id === item.id ? { ...i, enabled: e.target.checked } : i))
                  }
                />
              </div>
              <input
                type="text"
                value={item.name}
                onChange={e =>
                  setItems(items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i))
                }
                className="border rounded-md p-1 w-full"
              />
              <input
                type="number"
                value={item.price}
                onChange={e =>
                  setItems(items.map(i => i.id === item.id ? { ...i, price: Number(e.target.value) } : i))
                }
                className="border rounded-md p-1 w-full"
              />
              <div className="flex justify-center items-center">
                <input
                  type="checkbox"
                  checked={item.taxable ?? true}
                  onChange={e =>
                    setItems(items.map(i => i.id === item.id ? { ...i, taxable: e.target.checked } : i))
                  }
                />
              </div>
              <div className="text-sm font-medium">
                {item.taxable ? `$${round2(item.price*(item.taxRate??0.13))}` : "Tax-free"}
              </div>
              <button
                onClick={() => removeItem(item.id)}
                className="bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded text-sm w-12 transition"
              >
                X
              </button>
            </React.Fragment>
          ))}
          <button
            onClick={addItem}
            className="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded col-span-6 mt-1 w-full transition"
          >
            Add Item
          </button>
        </div>
        <div className="mb-4 font-semibold text-gray-700">Total Item Tax: ${totalItemTax}</div>

        {/* Estimates Div */}
        <div className="bg-indigo-50 p-4 rounded-lg mb-6 text-gray-700 space-y-1">
          <div>Estimated Hours Left: {estimatedHoursLeft}</div>
          <div>Estimated Work Days Left: {estimatedDaysLeft}</div>
          <div>Total Earned After Tax: ${totalEarned}</div>
          <div>Total Item Price After Tax: ${totalAfterTaxItemPrice}</div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={saveAllInputs} className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md transition">Save All</button>
          <button onClick={clearAll} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md transition">Clear All</button>
        </div>

        {/* Calendar */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <button onClick={prevMonth} className="px-2 py-1 bg-gray-300 rounded hover:bg-gray-400">Prev</button>
            <div className="font-semibold text-lg">{currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
            <button onClick={nextMonth} className="px-2 py-1 bg-gray-300 rounded hover:bg-gray-400">Next</button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center font-semibold text-gray-600 mb-1">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d}>{d}</div>)}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map(cell => {
              if(!cell.date) return <div key={cell.key} className="p-2 border rounded min-h-[60px] bg-gray-50"></div>;
              const cellDate = ymd(cell.date);
              const today = cellDate === todayStr;
              const start = cellDate === startDate;
              return (
                <div key={cell.key} 
                  className={`border rounded-lg p-2 min-h-[70px] flex flex-col justify-between items-center transition
                              ${today ? "bg-green-200 animate-pulse" : ""} 
                              ${start ? "bg-yellow-200" : ""}
                              hover:shadow-lg hover:bg-gray-100`}
                >
                  <div className="w-full text-left font-semibold">{cell.date.getDate()}</div>
                  <input 
                    type="number" 
                    min={0} max={24} 
                    value={cell.entry.hours} 
                    onChange={e => updateDay(cellDate, Number(e.target.value))} 
                    className="w-3/4 border rounded-md text-center text-sm focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="text-sm text-center text-gray-500 mt-4">
          This website is generated by AI, actual results may vary.
        </div>
      </div>
    </div>
  );
}
