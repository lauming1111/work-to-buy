import {
  DayHours,
  clampLunchMinutes,
  computeDetailedDays,
  computeJobEarnings,
  getIndexInfo,
  getLunchMinutes,
  getOriginalHours,
  isUnlawfulRuleJob,
  summarizeJobs,
} from './calc';

const START = '2024-01-01'; // Monday
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
    expect(getIndexInfo('2024-01-01', START)).toMatchObject({ weekIndex: 0, biWeekIndex: 0 });
    expect(getIndexInfo('2024-01-07', START)).toMatchObject({ weekIndex: 0, biWeekIndex: 0 });
    expect(getIndexInfo('2024-01-08', START)).toMatchObject({ weekIndex: 1, biWeekIndex: 0 });
    expect(getIndexInfo('2024-01-15', START)).toMatchObject({ weekIndex: 2, biWeekIndex: 1 });
  });
});

describe('computeDetailedDays - lawful rule', () => {
  const week = [
    day('2024-01-01', 10),
    day('2024-01-02', 10),
    day('2024-01-03', 10),
    day('2024-01-04', 10),
    day('2024-01-05', 10),
  ];

  test('pays 4% vacation pay on regular hours', () => {
    const [first] = computeDetailedDays({ dayHours: [day('2024-01-01', 8)], hourlyRate: 20, startDate: START });
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
      dayHours: [...week, day('2024-01-08', 10)],
      hourlyRate: 20,
      startDate: START,
    });
    expect(days[5].earnings).toBe(208);
  });

  test('deducts income tax, employee insurance and CPP from gross', () => {
    const [d] = computeDetailedDays({ dayHours: [day('2024-01-01', 8)], hourlyRate: 20, startDate: START });
    expect(d.incomeTax).toBe(19.47);
    expect(d.employeeInsurance).toBe(2.73);
    expect(d.cpp).toBe(9.12);
    expect(d.afterTax).toBe(135.08);
  });

  test('days with no hours are ignored, zero-hour days stay at zero', () => {
    const days = computeDetailedDays({
      dayHours: [day('2024-01-01', 0), { date: '2024-01-02' }],
      hourlyRate: 20,
      startDate: START,
    });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: '2024-01-01', hours: 0, earnings: 0, afterTax: 0 });
  });
});

describe('computeDetailedDays - "3495" unlawful rule', () => {
  // 10 days x 10h = 100h inside bi-week 0, which is 12h past the 88h threshold
  const biWeek = Array.from({ length: 10 }, (_, i) =>
    day(`2024-01-${String(i + 1).padStart(2, '0')}`, 10));

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
    expect(days[0].incomeTax).toBe(21.42);
    expect(days[0].afterTax).toBe(173.55);
  });

  test('under the threshold everything is taxed', () => {
    const short = [day('2024-01-01', 8), day('2024-01-02', 8)];
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
    dayHours: [day('2024-01-02', 8)],
  };
  const studio = {
    id: 'studio',
    name: 'Studio',
    hourlyRate: 30,
    startDate: START,
    dayHours: [day('2024-01-02', 8)],
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
    expect(summary.totalAfterTax).toBe(337.71); // 135.08 + 202.63
    expect(summary.totalAfterTax).toBeCloseTo(summary.jobs[0].afterTax + summary.jobs[1].afterTax, 2);
  });

  test('each job keeps its own start date for overtime buckets', () => {
    const shifted = {
      ...studio,
      startDate: '2024-01-08',
      dayHours: [day('2024-01-08', 10), day('2024-01-09', 10), day('2024-01-10', 10),
        day('2024-01-11', 10), day('2024-01-12', 10)],
    };
    const summary = summarizeJobs([shifted]);
    // 44 regular + 6 overtime hours on this job's own week
    expect(summary.jobs[0].gross).toBe(1653.6);
  });

  test('a job named "3495" uses the unlawful rule while the others do not', () => {
    const hours = Array.from({ length: 10 }, (_, i) =>
      day(`2024-01-${String(i + 1).padStart(2, '0')}`, 10));
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
