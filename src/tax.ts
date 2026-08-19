/**
 * Year-keyed Canadian payroll tax data and formulas (Ontario).
 *
 * Shapes follow the CRA "Payroll Deductions Formulas" guide (T4127): annualize a
 * pay period's taxable income, apply brackets and credits, then divide back down.
 * Every figure below is taken from CRA / Ontario published tables for its year.
 *
 * Deliberate simplifications, both far outside this app's income range:
 *  - The federal basic personal amount phase-out is ignored. It only begins above
 *    ~$181k, so the full BPA always applies here.
 *  - Only the credits an hourly employee always has are modelled (BPA, Canada
 *    employment amount, CPP/EI credits, Ontario tax reduction, Ontario health
 *    premium). Dependants, tuition, RRSP and the TD1 "other credits" box are not.
 *
 * These are withholding figures: what comes off a paycheque. Refundable credits
 * settled at filing time — the Ontario LIFT credit and the Canada Workers
 * Benefit — are deliberately absent, exactly as they are absent from T4127, so
 * a low earner's actual year-end tax will be lower than the total withheld here.
 *
 * This makes the app a good estimator, not payroll software. See AGENTS.md.
 */

export type Bracket = {
  /** Upper bound of this bracket. Infinity on the top bracket. */
  upTo: number;
  rate: number;
};

/**
 * One Ontario Health Premium band: above `over`, the premium is `base` plus
 * `rate` of the excess, never more than `cap`.
 */
export type HealthPremiumBand = { over: number; base: number; rate: number; cap: number };

/** Not indexed; unchanged since the premium was introduced in 2004. */
export const ONTARIO_HEALTH_PREMIUM: HealthPremiumBand[] = [
  { over: 20000, base: 0, rate: 0.06, cap: 300 },
  { over: 36000, base: 300, rate: 0.06, cap: 450 },
  { over: 48000, base: 450, rate: 0.25, cap: 600 },
  { over: 72000, base: 600, rate: 0.25, cap: 750 },
  { over: 200000, base: 750, rate: 0.25, cap: 900 },
];

export type TaxYearRates = {
  year: number;
  federal: {
    brackets: Bracket[];
    bpa: number;
    /** Canada employment amount, T4127 factor K4. */
    canadaEmploymentAmount: number;
  };
  ontario: {
    brackets: Bracket[];
    bpa: number;
    surtax: { threshold1: number; rate1: number; threshold2: number; rate2: number };
    /** Ontario tax reduction basic personal amount, T4127 factor S. */
    taxReduction: number;
    /** Ontario Health Premium bands, T4127 factor V2. */
    healthPremium: HealthPremiumBand[];
  };
  cpp: {
    /** Total employee rate on tier-1 contributory earnings. */
    rate: number;
    /**
     * The original pre-enhancement rate. The base portion earns a tax credit;
     * the enhanced portion (rate - baseRate) is a tax deduction instead.
     */
    baseRate: number;
    exemption: number;
    ympe: number;
    cpp2Rate: number;
    yampe: number;
  };
  ei: { rate: number; mie: number };
  /** Ontario HST, charged on taxable shopping-list items. Not a payroll rate. */
  salesTax: number;
};

/**
 * The federal lowest rate is 14.5% for 2025 because the cut from 15% to 14% took
 * effect July 1, 2025, so the year blends the two. It is 14% from 2026 onward.
 */
export const TAX_YEARS: Record<number, TaxYearRates> = {
  2025: {
    year: 2025,
    federal: {
      brackets: [
        { upTo: 57375, rate: 0.145 },
        { upTo: 114750, rate: 0.205 },
        { upTo: 177882, rate: 0.26 },
        { upTo: 253414, rate: 0.29 },
        { upTo: Infinity, rate: 0.33 },
      ],
      bpa: 16129,
      canadaEmploymentAmount: 1471,
    },
    ontario: {
      brackets: [
        { upTo: 52886, rate: 0.0505 },
        { upTo: 105775, rate: 0.0915 },
        { upTo: 150000, rate: 0.1116 },
        { upTo: 220000, rate: 0.1216 },
        { upTo: Infinity, rate: 0.1316 },
      ],
      bpa: 12747,
      surtax: { threshold1: 5710, rate1: 0.2, threshold2: 7307, rate2: 0.36 },
      taxReduction: 294,
      healthPremium: ONTARIO_HEALTH_PREMIUM,
    },
    cpp: { rate: 0.0595, baseRate: 0.0495, exemption: 3500, ympe: 71300, cpp2Rate: 0.04, yampe: 81200 },
    ei: { rate: 0.0164, mie: 65700 },
    salesTax: 0.13,
  },
  2026: {
    year: 2026,
    federal: {
      brackets: [
        { upTo: 58523, rate: 0.14 },
        { upTo: 117045, rate: 0.205 },
        { upTo: 181440, rate: 0.26 },
        { upTo: 258482, rate: 0.29 },
        { upTo: Infinity, rate: 0.33 },
      ],
      bpa: 16452,
      canadaEmploymentAmount: 1501,
    },
    ontario: {
      brackets: [
        { upTo: 53891, rate: 0.0505 },
        { upTo: 107785, rate: 0.0915 },
        { upTo: 150000, rate: 0.1116 },
        { upTo: 220000, rate: 0.1216 },
        { upTo: Infinity, rate: 0.1316 },
      ],
      bpa: 12989,
      surtax: { threshold1: 5818, rate1: 0.2, threshold2: 7446, rate2: 0.36 },
      taxReduction: 300,
      healthPremium: ONTARIO_HEALTH_PREMIUM,
    },
    cpp: { rate: 0.0595, baseRate: 0.0495, exemption: 3500, ympe: 74600, cpp2Rate: 0.04, yampe: 85000 },
    ei: { rate: 0.0163, mie: 68900 },
    salesTax: 0.13,
  },
};

const KNOWN_YEARS = Object.keys(TAX_YEARS).map(Number).sort((a, b) => a - b);
export const EARLIEST_TAX_YEAR = KNOWN_YEARS[0];
export const LATEST_TAX_YEAR = KNOWN_YEARS[KNOWN_YEARS.length - 1];

/**
 * Rates for a calendar year. Years outside the table clamp to the nearest one we
 * have, so old records and future dates still produce a sensible estimate rather
 * than throwing. Add a new entry each January instead of relying on the clamp.
 */
export function getTaxYearRates(year: number): TaxYearRates {
  if (TAX_YEARS[year]) return TAX_YEARS[year];
  if (!Number.isFinite(year)) return TAX_YEARS[LATEST_TAX_YEAR];
  return TAX_YEARS[Math.max(EARLIEST_TAX_YEAR, Math.min(LATEST_TAX_YEAR, year))];
}

/** Sales tax rate (Ontario HST) for a year. Separate from any payroll rate. */
export const getSalesTaxRate = (year: number) => getTaxYearRates(year).salesTax;

export const lowestRate = (brackets: Bracket[]) => brackets[0].rate;

/** Marginal tax across a bracket table. */
export function taxFromBrackets(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0;
  let tax = 0;
  let floor = 0;
  for (const b of brackets) {
    if (income <= floor) break;
    tax += (Math.min(income, b.upTo) - floor) * b.rate;
    floor = b.upTo;
  }
  return tax;
}

/* -------------------- CPP -------------------- */

export const maxCppBase = (r: TaxYearRates) => (r.cpp.ympe - r.cpp.exemption) * r.cpp.rate;
export const maxCpp2 = (r: TaxYearRates) => (r.cpp.yampe - r.cpp.ympe) * r.cpp.cpp2Rate;
export const maxEi = (r: TaxYearRates) => r.ei.mie * r.ei.rate;

export type CppYtd = { pensionable: number; base: number; cpp2: number };
export type CppResult = {
  /** Tier-1 contribution at the full rate. */
  base: number;
  /** Portion of `base` earning a tax credit (the pre-enhancement 4.95%). */
  creditPortion: number;
  /** Portion of `base` that is a tax deduction instead of a credit. */
  enhancedPortion: number;
  cpp2: number;
  total: number;
};

/**
 * One pay period's CPP. `periodExemption` is the $3,500 annual basic exemption
 * prorated over the year's pay periods, the way CRA applies it per cheque.
 */
export function computeCpp(
  pensionable: number,
  periodExemption: number,
  rates: TaxYearRates,
  ytd: CppYtd
): CppResult {
  const empty = { base: 0, creditPortion: 0, enhancedPortion: 0, cpp2: 0, total: 0 };
  if (pensionable <= 0) return empty;

  const tier1Room = Math.max(0, rates.cpp.ympe - ytd.pensionable);
  const tier1Earnings = Math.min(pensionable, tier1Room);
  const contributory = Math.max(0, tier1Earnings - periodExemption);
  const base = Math.min(contributory * rates.cpp.rate, Math.max(0, maxCppBase(rates) - ytd.base));

  const tier2Floor = Math.max(ytd.pensionable, rates.cpp.ympe);
  const tier2Room = Math.max(0, rates.cpp.yampe - tier2Floor);
  const tier2Earnings = Math.min(Math.max(0, pensionable - tier1Earnings), tier2Room);
  const cpp2 = Math.min(tier2Earnings * rates.cpp.cpp2Rate, Math.max(0, maxCpp2(rates) - ytd.cpp2));

  const creditPortion = base * (rates.cpp.baseRate / rates.cpp.rate);
  return { base, creditPortion, enhancedPortion: base - creditPortion, cpp2, total: base + cpp2 };
}

/* -------------------- EI -------------------- */

export type EiYtd = { insurable: number; premium: number };

/** One pay period's EI premium, capped by remaining insurable-earnings room. */
export function computeEi(insurable: number, rates: TaxYearRates, ytd: EiYtd): number {
  if (insurable <= 0) return 0;
  const room = Math.max(0, rates.ei.mie - ytd.insurable);
  const chargeable = Math.min(insurable, room);
  return Math.min(chargeable * rates.ei.rate, Math.max(0, maxEi(rates) - ytd.premium));
}

/* -------------------- Income tax -------------------- */

export type IncomeTaxInput = {
  /** Pay-period taxable income multiplied by the number of periods in the year. */
  annualTaxable: number;
  /** Annualized CPP amounts, split by their differing tax treatment. */
  annualCppCredit: number;
  annualCppDeduction: number;
  annualEi: number;
};

/** Ontario Health Premium on an annual taxable income, T4127 factor V2. */
export function ontarioHealthPremium(taxable: number, rates: TaxYearRates): number {
  let premium = 0;
  for (const band of rates.ontario.healthPremium) {
    if (taxable <= band.over) break;
    premium = Math.min(band.cap, band.base + (taxable - band.over) * band.rate);
  }
  return premium;
}

export function ontarioSurtax(ontarioTax: number, rates: TaxYearRates): number {
  const s = rates.ontario.surtax;
  return (
    Math.max(0, ontarioTax - s.threshold1) * s.rate1 +
    Math.max(0, ontarioTax - s.threshold2) * s.rate2
  );
}

/**
 * Annual federal + Ontario tax on an annualized income, T4127 shape.
 *
 * The enhanced portion of CPP and all of CPP2 reduce taxable income (a
 * deduction); the pre-enhancement portion and EI give credits at each
 * jurisdiction's lowest rate.
 */
export function computeIncomeTax(input: IncomeTaxInput, rates: TaxYearRates) {
  const { federal, ontario } = rates;
  const taxable = Math.max(0, input.annualTaxable - input.annualCppDeduction);
  const credited = input.annualCppCredit + input.annualEi;

  const fedLowest = lowestRate(federal.brackets);
  const federalCredits =
    fedLowest * (federal.bpa + credited + Math.min(taxable, federal.canadaEmploymentAmount));
  const federalTax = Math.max(0, taxFromBrackets(taxable, federal.brackets) - federalCredits);

  const ontLowest = lowestRate(ontario.brackets);
  const ontarioBasic = Math.max(
    0,
    taxFromBrackets(taxable, ontario.brackets) - ontLowest * (ontario.bpa + credited)
  );
  const withSurtax = ontarioBasic + ontarioSurtax(ontarioBasic, rates);
  // Ontario tax reduction: wipes the tax out entirely below the personal amount,
  // then claws back linearly until it is gone at twice that amount.
  const reduction = Math.max(0, Math.min(withSurtax, 2 * ontario.taxReduction - withSurtax));
  // The health premium is added after the reduction; the reduction cannot offset it.
  const ontarioTax = Math.max(0, withSurtax - reduction) + ontarioHealthPremium(taxable, rates);

  return { federal: federalTax, ontario: ontarioTax, total: federalTax + ontarioTax };
}
