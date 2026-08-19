import {
  DEFAULT_JOB_ID,
  isPaymentCycle,
  safeSetItem,
  LEGACY_STORAGE_KEYS,
  clearJobStorage,
  getInitialActiveJobId,
  getInitialJobs,
  jobStorageKey,
  loadJobData,
  safeParse,
} from './storage';

beforeEach(() => localStorage.clear());

describe('safeParse', () => {
  test('falls back on missing, broken or null JSON', () => {
    expect(safeParse<number[]>(null, [])).toEqual([]);
    expect(safeParse<number[]>('{not json', [])).toEqual([]);
    expect(safeParse<number[]>('null', [])).toEqual([]);
    expect(safeParse<number[]>('[1,2]', [])).toEqual([1, 2]);
  });
});

describe('job list', () => {
  test('starts with a single default job', () => {
    expect(getInitialJobs()).toEqual([{ id: DEFAULT_JOB_ID, name: 'Main Job' }]);
  });

  test('reads the stored job list', () => {
    localStorage.setItem('w2b_jobs', JSON.stringify([{ id: 'a', name: 'Cafe' }, { id: 'b', name: 'Studio' }]));
    expect(getInitialJobs().map(j => j.name)).toEqual(['Cafe', 'Studio']);
  });

  test('active job falls back to the first job when the stored id is gone', () => {
    const jobs = [{ id: 'a', name: 'Cafe' }, { id: 'b', name: 'Studio' }];
    localStorage.setItem('w2b_activeJob', 'b');
    expect(getInitialActiveJobId(jobs)).toBe('b');
    localStorage.setItem('w2b_activeJob', 'deleted');
    expect(getInitialActiveJobId(jobs)).toBe('a');
  });
});

describe('per-job data', () => {
  test('each job keeps its own hourly rate', () => {
    localStorage.setItem(jobStorageKey('a', 'hourlyRate'), '20');
    localStorage.setItem(jobStorageKey('b', 'hourlyRate'), '33.5');
    expect(loadJobData('a').hourlyRate).toBe(20);
    expect(loadJobData('b').hourlyRate).toBe(33.5);
  });

  test('an unknown job gets the defaults, not another job\'s data', () => {
    localStorage.setItem(jobStorageKey('a', 'hourlyRate'), '20');
    expect(loadJobData('b').hourlyRate).toBe(17.6);
    expect(loadJobData('b').dayHours).toEqual([]);
  });

  test('a non-numeric stored rate falls back to the default', () => {
    localStorage.setItem(jobStorageKey('a', 'hourlyRate'), 'abc');
    expect(loadJobData('a').hourlyRate).toBe(17.6);
  });

  test('a broken stored date falls back to today', () => {
    localStorage.setItem(jobStorageKey('a', 'currentDate'), 'not-a-date');
    expect(isNaN(loadJobData('a').currentDate.getTime())).toBe(false);
  });
});

describe('legacy single-job storage', () => {
  test('the default job still reads the pre-multi-job keys', () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.hourlyRate, '15');
    localStorage.setItem(LEGACY_STORAGE_KEYS.dayHours, JSON.stringify([{ date: '2024-01-01', hours: 8 }]));
    expect(loadJobData(DEFAULT_JOB_ID).hourlyRate).toBe(15);
    expect(loadJobData(DEFAULT_JOB_ID).dayHours).toHaveLength(1);
  });

  test('other jobs never see the legacy keys', () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.hourlyRate, '15');
    expect(loadJobData('b').hourlyRate).toBe(17.6);
  });

  test('the scoped key wins over the legacy key', () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.hourlyRate, '15');
    localStorage.setItem(jobStorageKey(DEFAULT_JOB_ID, 'hourlyRate'), '21');
    expect(loadJobData(DEFAULT_JOB_ID).hourlyRate).toBe(21);
  });
});

describe('clearJobStorage', () => {
  test('clears one job without touching the others', () => {
    localStorage.setItem(jobStorageKey('a', 'hourlyRate'), '20');
    localStorage.setItem(jobStorageKey('b', 'hourlyRate'), '30');
    clearJobStorage('a');
    expect(loadJobData('a').hourlyRate).toBe(17.6);
    expect(loadJobData('b').hourlyRate).toBe(30);
  });

  test('clearing the default job also drops the legacy keys', () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.hourlyRate, '15');
    localStorage.setItem(jobStorageKey(DEFAULT_JOB_ID, 'hourlyRate'), '21');
    clearJobStorage(DEFAULT_JOB_ID);
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.hourlyRate)).toBeNull();
    expect(loadJobData(DEFAULT_JOB_ID).hourlyRate).toBe(17.6);
  });
});

describe('payment cycle and roster', () => {
  test('recognises only the three known cycles', () => {
    expect(isPaymentCycle('biweekly')).toBe(true);
    expect(isPaymentCycle('semi-monthly')).toBe(true);
    expect(isPaymentCycle('monthly')).toBe(true);
    expect(isPaymentCycle('weekly')).toBe(false);
    expect(isPaymentCycle(null)).toBe(false);
  });

  test('each job keeps its own pay cycle', () => {
    localStorage.setItem(jobStorageKey('a', 'payCycle'), 'monthly');
    expect(loadJobData('a').payCycle).toBe('monthly');
    expect(loadJobData('b').payCycle).toBe('biweekly');
  });

  test('an unknown stored cycle falls back to bi-weekly', () => {
    localStorage.setItem(jobStorageKey('a', 'payCycle'), 'yearly');
    expect(loadJobData('a').payCycle).toBe('biweekly');
  });

  test('a missing roster loads as empty, not undefined', () => {
    expect(loadJobData('a').roster).toEqual({ weekly: {}, monthly: {} });
  });
});

describe('safeSetItem', () => {
  test('reports success on a normal write', () => {
    expect(safeSetItem('w2b_probe', '1')).toBe(true);
    expect(localStorage.getItem('w2b_probe')).toBe('1');
  });

  test('swallows a full-quota failure instead of throwing', () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(safeSetItem('w2b_probe', '1')).toBe(false);
    setItem.mockRestore();
  });
});
