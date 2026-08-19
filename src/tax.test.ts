import {
  EARLIEST_TAX_YEAR,
  LATEST_TAX_YEAR,
  TAX_YEARS,
  computeCpp,
  computeEi,
  computeIncomeTax,
  getSalesTaxRate,
  getTaxYearRates,
  maxCpp2,
  maxCppBase,
  maxEi,
  ontarioHealthPremium,
  ontarioSurtax,
  taxFromBrackets,
} from './tax';

const y2026 = TAX_YEARS[2026];
const y2025 = TAX_YEARS[2025];
const noCpp = { pensionable: 0, base: 0, cpp2: 0 };
const noEi = { insurable: 0, premium: 0 };

describe('tax year lookup', () => {
  test('returns the table for a known year', () => {
    expect(getTaxYearRates(2025).year).toBe(2025);
    expect(getTaxYearRates(2026).year).toBe(2026);
  });

  test('years outside the table clamp to the nearest one', () => {
    expect(getTaxYearRates(2019).year).toBe(EARLIEST_TAX_YEAR);
    expect(getTaxYearRates(2099).year).toBe(LATEST_TAX_YEAR);
    expect(getTaxYearRates(NaN).year).toBe(LATEST_TAX_YEAR);
  });

  test('sales tax is Ontario HST, not any payroll rate', () => {
    expect(getSalesTaxRate(2026)).toBe(0.13);
    expect(getSalesTaxRate(2025)).toBe(0.13);
  });

  test('the published annual maximums fall out of the constants', () => {
    expect(maxCppBase(y2026)).toBeCloseTo(4230.45, 2);
    expect(maxCpp2(y2026)).toBeCloseTo(416, 2);
    expect(maxEi(y2026)).toBeCloseTo(1123.07, 2);
    expect(maxCppBase(y2025)).toBeCloseTo(4034.1, 2);
    expect(maxCpp2(y2025)).toBeCloseTo(396, 2);
    expect(maxEi(y2025)).toBeCloseTo(1077.48, 2);
  });
});

describe('bracket arithmetic', () => {
  test('nothing is owed on nothing', () => {
    expect(taxFromBrackets(0, y2026.federal.brackets)).toBe(0);
    expect(taxFromBrackets(-100, y2026.federal.brackets)).toBe(0);
  });

  test('the lowest rate applies right up to the first threshold', () => {
    expect(taxFromBrackets(58523, y2026.federal.brackets)).toBeCloseTo(58523 * 0.14, 2);
  });

  test('only the excess is taxed at the next rate', () => {
    expect(taxFromBrackets(58524, y2026.federal.brackets)).toBeCloseTo(58523 * 0.14 + 0.205, 2);
  });

  test('2025 uses the blended 14.5% lowest rate, 2026 uses 14%', () => {
    expect(y2025.federal.brackets[0].rate).toBe(0.145);
    expect(y2026.federal.brackets[0].rate).toBe(0.14);
  });
});

describe('CPP', () => {
  test('the basic exemption comes off before the rate applies', () => {
    const r = computeCpp(50000, 3500, y2026, noCpp);
    expect(r.total).toBeCloseTo((50000 - 3500) * 0.0595, 2);
  });

  test('earnings under the period exemption contribute nothing', () => {
    expect(computeCpp(100, 134.62, y2026, noCpp).total).toBe(0);
    expect(computeCpp(0, 0, y2026, noCpp).total).toBe(0);
  });

  test('tier one stops at the YMPE', () => {
    const r = computeCpp(200000, 3500, y2026, noCpp);
    expect(r.base).toBeCloseTo(maxCppBase(y2026), 2);
  });

  test('CPP2 covers earnings between the YMPE and the YAMPE', () => {
    const r = computeCpp(80000, 3500, y2026, noCpp);
    expect(r.cpp2).toBeCloseTo((80000 - 74600) * 0.04, 2);
  });

  test('CPP2 stops at the YAMPE', () => {
    expect(computeCpp(200000, 3500, y2026, noCpp).cpp2).toBeCloseTo(maxCpp2(y2026), 2);
  });

  test('year-to-date contributions consume the room', () => {
    const spent = { pensionable: y2026.cpp.ympe, base: maxCppBase(y2026), cpp2: 0 };
    expect(computeCpp(5000, 0, y2026, spent).base).toBe(0);
  });

  test('the enhanced portion is a deduction, the rest earns a credit', () => {
    const r = computeCpp(50000, 3500, y2026, noCpp);
    expect(r.creditPortion).toBeCloseTo(r.base * (4.95 / 5.95), 2);
    expect(r.creditPortion + r.enhancedPortion).toBeCloseTo(r.base, 6);
    expect(r.enhancedPortion).toBeCloseTo(465, 0); // matches published payroll figures
  });
});

describe('EI', () => {
  test('a flat rate up to the maximum insurable earnings', () => {
    expect(computeEi(50000, y2026, noEi)).toBeCloseTo(50000 * 0.0163, 2);
  });

  test('premiums stop at the maximum', () => {
    expect(computeEi(200000, y2026, noEi)).toBeCloseTo(maxEi(y2026), 2);
  });

  test('the rate dropped from 1.64% in 2025 to 1.63% in 2026', () => {
    expect(computeEi(10000, y2025, noEi)).toBeCloseTo(164, 2);
    expect(computeEi(10000, y2026, noEi)).toBeCloseTo(163, 2);
  });

  test('year-to-date insurable earnings consume the room', () => {
    expect(computeEi(5000, y2026, { insurable: y2026.ei.mie, premium: maxEi(y2026) })).toBe(0);
  });
});

describe('Ontario surtax, health premium and tax reduction', () => {
  test('no surtax below the first threshold', () => {
    expect(ontarioSurtax(y2026.ontario.surtax.threshold1, y2026)).toBe(0);
  });

  test('both surtax rates stack above the second threshold', () => {
    const s = y2026.ontario.surtax;
    expect(ontarioSurtax(10000, y2026)).toBeCloseTo(
      (10000 - s.threshold1) * 0.2 + (10000 - s.threshold2) * 0.36, 2);
  });

  test('the health premium starts at $20,000 and steps up in bands', () => {
    expect(ontarioHealthPremium(20000, y2026)).toBe(0);
    expect(ontarioHealthPremium(36000, y2026)).toBeCloseTo(300, 2);
    expect(ontarioHealthPremium(48000, y2026)).toBeCloseTo(450, 2);
    expect(ontarioHealthPremium(72000, y2026)).toBeCloseTo(600, 2);
    expect(ontarioHealthPremium(1000000, y2026)).toBeCloseTo(900, 2);
  });
});

describe('income tax', () => {
  const plain = (annualTaxable: number) =>
    computeIncomeTax({ annualTaxable, annualCppCredit: 0, annualCppDeduction: 0, annualEi: 0 }, y2026);

  test('the personal amounts wipe out tax on a low income', () => {
    expect(plain(15000).total).toBe(0);
  });

  test('nothing goes negative', () => {
    expect(plain(0).total).toBe(0);
    expect(plain(-5000).total).toBe(0);
  });

  test('the Ontario tax reduction zeroes small provincial bills', () => {
    // Ontario tax reaches the $300 reduction amount around $18,930 of income.
    expect(plain(18000).ontario).toBe(0);
    expect(plain(30000).ontario).toBeGreaterThan(0);
  });

  test('matches published figures for a $50,000 Ontario salary in 2026', () => {
    const cpp = computeCpp(50000, 3500, y2026, noCpp);
    const ei = computeEi(50000, y2026, noEi);
    const t = computeIncomeTax({
      annualTaxable: 50000,
      annualCppCredit: cpp.creditPortion,
      annualCppDeduction: cpp.enhancedPortion + cpp.cpp2,
      annualEi: ei,
    }, y2026);
    expect(cpp.total).toBeCloseTo(2766.75, 2);
    expect(ei).toBeCloseTo(815, 2);
    expect(t.federal).toBeCloseTo(3985, 0);
    // basic Ontario tax plus the $600 health premium at this income
    expect(t.ontario).toBeCloseTo(2288, 0);
  });

  test('the CPP enhancement reduces taxable income', () => {
    const withDeduction = computeIncomeTax(
      { annualTaxable: 50000, annualCppCredit: 0, annualCppDeduction: 465, annualEi: 0 }, y2026);
    expect(withDeduction.total).toBeLessThan(plain(50000).total);
  });

  test('CPP and EI credits reduce tax', () => {
    const credited = computeIncomeTax(
      { annualTaxable: 50000, annualCppCredit: 2301, annualCppDeduction: 0, annualEi: 815 }, y2026);
    expect(credited.total).toBeLessThan(plain(50000).total);
  });
});
