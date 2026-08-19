import {
  DayHours,
  PaymentCycle,
  clampLunchMinutes,
  computeDetailedDays,
  computeJobEarnings,
  getIndexInfo,
  getLunchMinutes,
  getPeriodKey,
  getOriginalHours,
  isUnlawfulRuleJob,
  summarizeJobs,
} from './calc';

const START = '2026-01-01';
const day = (date: string, hours: number): DayHours => ({ date, hours });

describe('lunch helpers', () => {
  test('missing lunchMinutes falls back to the 30 minute default', () => {
    expect(getLunchMinutes({ date: START })).toBe(30);
  });

  test('legacy lunch:false means no deduction', () => {
    expect(getLunchMinutes({ date: START, lunch: false })).toBe(0);
  });

  test('explicit lunchMinutes wins over the legacy flag', () => {
    expect(getLunchMinutes({ date: START, lunch: false, lunchMinutes: 45 })).toBe(45);
  });

  test('lunch minutes are clamped to 0..180', () => {
    expect(clampLunchMinutes(-10)).toBe(0);
    expect(clampLunchMinutes(999)).toBe(180);
    expect(clampLunchMinutes(NaN)).toBe(30);
    expect(clampLunchMinutes(null)).toBe(30);
  });

  test('legacy entries without originalHours reuse hours', () => {
    expect(getOriginalHours({ date: START, hours: 7.5 })).toBe(7.5);
    expect(getOriginalHours({ date: START, hours: 7.5, start: '09:00', end: '17:00' })).toBeNull();
  });
});

describe('week and bi-week indices', () => {
  test('buckets are counted from the job start date, not the calendar', () => {
    expect(getIndexInfo('2026-01-01', START)).toMatchObject({ weekIndex: 0, biWeekIndex: 0 });
    expect(getIndexInfo('2026-01-07', START)).toMatchObject({ weekIndex: 0, biWeekIndex: 0 });
    expect(getIndexInfo('2026-01-08', START)).toMatchObject({ weekIndex: 1, biWeekIndex: 0 });
    expect(getIndexInfo('2026-01-15', START)).toMatchObject({ weekIndex: 2, biWeekIndex: 1 });
  });
});

describe('computeDetailedDays - lawful rule', () => {
  const week = [
    day('2026-01-01', 10),
    day('2026-01-02', 10),
    day('2026-01-03', 10),
    day('2026-01-04', 10),
    day('2026-01-05', 10),
  ];

  test('pays 4% vacation pay on regular hours', () => {
    const [first] = computeDetailedDays({ dayHours: [day('2026-01-01', 8)], hourlyRate: 20, startDate: START });
    expect(first.earnings).toBe(166.4); // 8 * 20 * 1.04
  });

  test('pays 1.5x once the week passes 44 hours', () => {
    const days = computeDetailedDays({ dayHours: week, hourlyRate: 20, startDate: START });
    expect(days.slice(0, 4).map(d => d.earnings)).toEqual([208, 208, 208, 208]);
    // 4 regular hours + 6 overtime hours
    expect(days[4].earnings).toBe(270.4);
  });

  test('the overtime counter resets on the next week', () => {
    const days = computeDetailedDays({
      dayHours: [...week, day('2026-01-08', 10)],
      hourlyRate: 20,
      startDate: START,
    });
    expect(days[5].earnings).toBe(208);
  });

  test('deducts income tax, employee insurance and CPP from gross', () => {
    const [d] = computeDetailedDays({ dayHours: [day('2026-01-01', 8)], hourlyRate: 20, startDate: START });
    // A single 8h day annualizes to $4,326, far under the basic personal
    // amount, so no income tax is withheld at all.
    expect(d.incomeTax).toBe(0);
    expect(d.employeeInsurance).toBe(2.71); // 166.40 * 1.63%
    expect(d.cpp).toBe(1.89); // (166.40 - 3500/26) * 5.95%
    expect(d.afterTax).toBe(161.8);
  });

  test('income tax appears once annualized pay clears the personal amounts', () => {
    const fortnight = Array.from({ length: 10 }, (_, i) =>
      day(`2026-01-${String(i + 1).padStart(2, '0')}`, 8));
    const days = computeDetailedDays({ dayHours: fortnight, hourlyRate: 40, startDate: START });
    expect(days.reduce((s, d) => s + d.incomeTax, 0)).toBeGreaterThan(0);
  });

  test('every day balances and nothing is lost to rounding', () => {
    const fortnight = Array.from({ length: 10 }, (_, i) =>
      day(`2026-01-${String(i + 1).padStart(2, '0')}`, 7.5));
    const days = computeDetailedDays({ dayHours: fortnight, hourlyRate: 33.33, startDate: START });
    days.forEach(d => {
      expect(d.afterTax).toBeCloseTo(d.earnings - d.incomeTax - d.employeeInsurance - d.cpp, 2);
    });
    const total = (k: 'earnings' | 'incomeTax' | 'employeeInsurance' | 'cpp' | 'afterTax') =>
      days.reduce((s, d) => s + d[k], 0);
    expect(total('afterTax')).toBeCloseTo(
      total('earnings') - total('incomeTax') - total('employeeInsurance') - total('cpp'), 2);
  });

  test('days with no hours are ignored, zero-hour days stay at zero', () => {
    const days = computeDetailedDays({
      dayHours: [day('2026-01-01', 0), { date: '2026-01-02' }],
      hourlyRate: 20,
      startDate: START,
    });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: '2026-01-01', hours: 0, earnings: 0, afterTax: 0 });
  });
});

describe('computeDetailedDays - "3495" unlawful rule', () => {
  // 10 days x 10h = 100h inside bi-week 0, which is 12h past the 88h threshold
  const biWeek = Array.from({ length: 10 }, (_, i) =>
    day(`2026-01-${String(i + 1).padStart(2, '0')}`, 10));

  test('opted into by naming the job exactly "3495"', () => {
    expect(isUnlawfulRuleJob('3495')).toBe(true);
    expect(isUnlawfulRuleJob(' 3495 ')).toBe(true);
    expect(isUnlawfulRuleJob('3495 Main Job')).toBe(false);
    expect(isUnlawfulRuleJob(undefined)).toBe(false);
  });

  test('pays no overtime multiplier', () => {
    const days = computeDetailedDays({ dayHours: biWeek, hourlyRate: 20, startDate: START, useUnlawfulRule: true });
    days.forEach(d => expect(d.earnings).toBe(208)); // 10 * 20 * 1.04, every day
  });

  test('hours past 88 in the bi-week are untaxed, pro-rata across its days', () => {
    const days = computeDetailedDays({ dayHours: biWeek, hourlyRate: 20, startDate: START, useUnlawfulRule: true });
    // each day carries 1.2 tax-free hours, so only 8.8h * 20 * 1.04 = 183.04 is taxed
    expect(days[0].incomeTax).toBe(21.92);
    expect(days[0].afterTax).toBe(173.01);
  });

  test('leaves more in hand than the lawful rule on the same hours', () => {
    const unlawful = computeDetailedDays({ dayHours: biWeek, hourlyRate: 20, startDate: START, useUnlawfulRule: true });
    const lawful = computeDetailedDays({ dayHours: biWeek, hourlyRate: 20, startDate: START });
    expect(unlawful[0].afterTax).toBeGreaterThan(lawful[0].afterTax);
  });

  test('under the threshold everything is taxed', () => {
    const short = [day('2026-01-01', 8), day('2026-01-02', 8)];
    const unlawful = computeDetailedDays({ dayHours: short, hourlyRate: 20, startDate: START, useUnlawfulRule: true });
    const lawful = computeDetailedDays({ dayHours: short, hourlyRate: 20, startDate: START });
    expect(unlawful).toEqual(lawful);
  });
});

describe('summarizeJobs', () => {
  const cafe = {
    id: 'cafe',
    name: 'Cafe',
    hourlyRate: 20,
    startDate: START,
    dayHours: [day('2026-01-02', 8)],
  };
  const studio = {
    id: 'studio',
    name: 'Studio',
    hourlyRate: 30,
    startDate: START,
    dayHours: [day('2026-01-02', 8)],
  };

  test('each job is priced on its own hourly rate', () => {
    const summary = summarizeJobs([cafe, studio]);
    expect(summary.jobs.map(j => j.gross)).toEqual([166.4, 249.6]);
    expect(summary.jobs.map(j => j.hourlyRate)).toEqual([20, 30]);
  });

  test('combines hours and after-tax pay across jobs', () => {
    const summary = summarizeJobs([cafe, studio]);
    expect(summary.totalHours).toBe(16);
    expect(summary.totalGross).toBe(416);
    expect(summary.totalAfterTax).toBe(400.49); // 161.80 + 238.69
    expect(summary.totalAfterTax).toBeCloseTo(summary.jobs[0].afterTax + summary.jobs[1].afterTax, 2);
  });

  test('each job keeps its own start date for overtime buckets', () => {
    const shifted = {
      ...studio,
      startDate: '2026-01-08',
      dayHours: [day('2026-01-08', 10), day('2026-01-09', 10), day('2026-01-10', 10),
        day('2026-01-11', 10), day('2026-01-12', 10)],
    };
    const summary = summarizeJobs([shifted]);
    // 44 regular + 6 overtime hours on this job's own week
    expect(summary.jobs[0].gross).toBe(1653.6);
  });

  test('a job named "3495" uses the unlawful rule while the others do not', () => {
    const hours = Array.from({ length: 10 }, (_, i) =>
      day(`2026-01-${String(i + 1).padStart(2, '0')}`, 10));
    const summary = summarizeJobs([
      { id: 'a', name: '3495', hourlyRate: 20, startDate: START, dayHours: hours },
      { id: 'b', name: 'Cafe', hourlyRate: 20, startDate: START, dayHours: hours },
    ]);
    const [unlawful, lawful] = summary.jobs;
    expect(unlawful.hours).toBe(lawful.hours);
    expect(unlawful.gross).toBeLessThan(lawful.gross); // no overtime multiplier
    expect(unlawful.afterTax).toBeGreaterThan(0);
  });

  test('a job with no recorded hours still appears, at zero', () => {
    const summary = summarizeJobs([cafe, { ...studio, dayHours: [] }]);
    expect(summary.jobs[1]).toMatchObject({ id: 'studio', hours: 0, gross: 0, afterTax: 0 });
    expect(summary.totalAfterTax).toBe(summary.jobs[0].afterTax);
  });

  test('no jobs means zero, not NaN', () => {
    expect(summarizeJobs([])).toEqual({ jobs: [], totalHours: 0, totalGross: 0, totalAfterTax: 0 });
  });

  test('computeJobEarnings matches a single-job summary', () => {
    expect(summarizeJobs([cafe]).jobs[0]).toEqual(computeJobEarnings(cafe));
  });
});

describe('pay periods and the tax year', () => {
  test('daylight saving does not shift a date into the wrong week', () => {
    // 2026-03-08 is the spring-forward date; the day before and after must still
    // land one calendar day apart.
    expect(getIndexInfo('2026-03-08', '2026-01-05').diffDays).toBe(62);
    expect(getIndexInfo('2026-03-09', '2026-01-05').diffDays).toBe(63);
    expect(getIndexInfo('2026-03-09', '2026-01-05').weekIndex).toBe(9);
  });

  test('a full year of 40h weeks stays under the weekly overtime threshold', () => {
    const days: DayHours[] = [];
    const start = new Date(2026, 0, 5);
    for (let i = 0; i < 364; i++) {
      const d = new Date(2026, 0, 5 + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      days.push(day(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 8));
    }
    const priced = computeDetailedDays({ dayHours: days, hourlyRate: 17.6, startDate: '2026-01-05' });
    expect(priced).toHaveLength(260);
    expect(start.getDay()).toBe(1); // the fixture really does start on a Monday
    priced.forEach(d => expect(d.earnings).toBe(146.43)); // never the 1.5x rate
  });

  test('each period is priced with its own calendar year rates', () => {
    const days = computeDetailedDays({
      dayHours: [day('2025-12-10', 8), day('2026-01-12', 8)],
      hourlyRate: 100,
      startDate: '2025-12-01',
      payCycle: 'monthly',
    });
    expect(days[0].employeeInsurance).toBe(13.64); // 832 * 1.64%, the 2025 rate
    expect(days[1].employeeInsurance).toBe(13.56); // 832 * 1.63%, the 2026 rate
  });

  test('CPP and EI stop at the annual maximums', () => {
    const months = Array.from({ length: 12 }, (_, i) =>
      day(`2026-${String(i + 1).padStart(2, '0')}-10`, 8));
    const days = computeDetailedDays({
      dayHours: months, hourlyRate: 1000, startDate: '2026-01-01', payCycle: 'monthly',
    });
    const total = (k: 'employeeInsurance' | 'cpp') => days.reduce((s, d) => s + d[k], 0);
    expect(total('employeeInsurance')).toBeCloseTo(68900 * 0.0163, 1); // 1,123.07
    // base CPP to the YMPE, plus CPP2 between the YMPE and the YAMPE
    expect(total('cpp')).toBeCloseTo((74600 - 3500) * 0.0595 + (85000 - 74600) * 0.04, 1);
  });

  test('the pay cycle changes how the CPP exemption is prorated', () => {
    const two = [day('2026-03-10', 8), day('2026-03-20', 8)];
    const cpp = (payCycle: PaymentCycle) =>
      computeDetailedDays({ dayHours: two, hourlyRate: 40, startDate: '2026-03-01', payCycle })
        .reduce((s, d) => s + d.cpp, 0);
    // semi-monthly splits these two days into separate periods, so each gets its
    // own slice of the basic exemption; bi-weekly keeps them together.
    expect(cpp('biweekly')).toBeCloseTo(23.58, 2);
    expect(cpp('semi-monthly')).toBeCloseTo(22.24, 2);
    expect(cpp('monthly')).toBeCloseTo(22.25, 2);
  });

  test('period buckets follow the cycle', () => {
    expect(getPeriodKey('2026-01-01', 'biweekly', '2026-01-01')).toBe(getPeriodKey('2026-01-14', 'biweekly', '2026-01-01'));
    expect(getPeriodKey('2026-01-01', 'biweekly', '2026-01-01')).not.toBe(getPeriodKey('2026-01-15', 'biweekly', '2026-01-01'));
    expect(getPeriodKey('2026-01-15', 'semi-monthly', START)).not.toBe(getPeriodKey('2026-01-16', 'semi-monthly', START));
    expect(getPeriodKey('2026-01-31', 'monthly', START)).toBe(getPeriodKey('2026-01-01', 'monthly', START));
  });
});
