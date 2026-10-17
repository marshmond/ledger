import { describe, expect, it } from 'vitest';
import { disabilityNeed, emergencyFund, findings, lifeNeed, newPolicy, umbrellaNeed } from './protection';

const $ = (n: number) => Math.round(n * 100);
const fmt = (c: number) => `$${(c / 100).toFixed(0)}`;

describe('emergency fund', () => {
  it('counts the months your cash would cover', () => {
    const f = emergencyFund($(30000), $(5000), 2);
    expect(f.months).toBe(6);
    expect(f.status).toBe('good');
    expect(f.targetMonths).toBe(4);
    expect(f.shortfallCents).toBe(0);
  });
  it('is stricter for a one-income household', () => {
    const f = emergencyFund($(20000), $(5000), 1);
    expect(f.targetMonths).toBe(6);
    expect(f.status).toBe('ok');
    expect(f.shortfallCents).toBe($(10000));
  });
  it('flags under three months and handles unknown spending', () => {
    expect(emergencyFund($(8000), $(5000), 2).status).toBe('low');
    expect(emergencyFund($(8000), 0, 2)).toMatchObject({ months: null, status: 'unknown' });
  });
});

describe('life insurance need', () => {
  const base = { grossAnnualCents: $(150000), yearsOfIncome: 10, debtsCents: $(300000), educationCents: $(100000), assetsCents: $(200000), subtractAssets: false, coverageCents: $(500000) };
  it('is income for several years plus debts plus education', () => {
    const n = lifeNeed(base);
    expect(n.needCents).toBe($(1500000) + $(300000) + $(100000));
    expect(n.netNeedCents).toBe(n.needCents);
    expect(n.gapCents).toBe(n.needCents - $(500000));
    expect(n.multiple).toBeCloseTo(500000 / 150000, 5);
  });
  it('can subtract savings you already have', () => {
    const n = lifeNeed({ ...base, subtractAssets: true });
    expect(n.netNeedCents).toBe($(1900000) - $(200000));
  });
  it('no gap when covered, and never negative', () => {
    expect(lifeNeed({ ...base, coverageCents: $(5000000) }).gapCents).toBe(0);
    expect(lifeNeed({ ...base, subtractAssets: true, assetsCents: $(9000000) }).netNeedCents).toBe(0);
    expect(lifeNeed({ ...base, grossAnnualCents: 0 }).multiple).toBeNull();
  });
});

describe('disability and umbrella', () => {
  it('replaces about 60% of pay', () => {
    const d = disabilityNeed($(120000), $(4000));
    expect(d.neededMonthlyCents).toBe($(6000));
    expect(d.gapMonthlyCents).toBe($(2000));
    expect(disabilityNeed($(120000), $(7000)).gapMonthlyCents).toBe(0);
  });
  it('suggests a limit at least as large as net worth, in million-dollar steps', () => {
    expect(umbrellaNeed($(200000), 0).suggestedCents).toBe($(1000000));
    expect(umbrellaNeed($(1200000), $(1000000))).toEqual({ suggestedCents: $(2000000), coverageCents: $(1000000), gapCents: $(1000000) });
    expect(umbrellaNeed($(900000), $(2000000)).gapCents).toBe(0);
    expect(umbrellaNeed(-$(5000), 0).suggestedCents).toBe($(1000000));
  });
});

describe('findings', () => {
  const person = (over = {}) => ({ id: 1, name: 'Alex', grossAnnualCents: $(150000), life: lifeNeed({ grossAnnualCents: $(150000), yearsOfIncome: 10, debtsCents: 0, educationCents: 0, assetsCents: 0, subtractAssets: false, coverageCents: 0 }), disability: disabilityNeed($(150000), 0), hasLifePolicy: false, hasDisabilityPolicy: false, ...over });
  const base = { fund: emergencyFund($(30000), $(5000), 2), people: [person()], umbrella: umbrellaNeed($(300000), 0), dependents: true, fmt };
  it('warns about missing life, disability, and umbrella coverage', () => {
    const f = findings(base);
    expect(f.find((x) => x.id === 'life-1')).toMatchObject({ level: 'warn' });
    expect(f.find((x) => x.id === 'dis-1')).toMatchObject({ level: 'warn' });
    expect(f.find((x) => x.id === 'umbrella')).toMatchObject({ level: 'warn' });
    expect(f.find((x) => x.id === 'fund')).toMatchObject({ level: 'ok' });
  });
  it('is calmer once coverage is entered', () => {
    const covered = person({
      life: lifeNeed({ grossAnnualCents: $(150000), yearsOfIncome: 10, debtsCents: 0, educationCents: 0, assetsCents: 0, subtractAssets: false, coverageCents: $(2000000) }),
      disability: disabilityNeed($(150000), $(8000)), hasLifePolicy: true, hasDisabilityPolicy: true,
    });
    const f = findings({ ...base, people: [covered], umbrella: umbrellaNeed($(300000), $(1000000)) });
    expect(f.filter((x) => x.level === 'warn')).toEqual([]);
    expect(f.find((x) => x.id === 'life-1')!.level).toBe('ok');
  });
  it('skips people with no income and flags a thin emergency fund', () => {
    const f = findings({ ...base, people: [person({ grossAnnualCents: 0 })], fund: emergencyFund($(5000), $(5000), 2) });
    expect(f.some((x) => x.id.startsWith('life') || x.id.startsWith('dis'))).toBe(false);
    expect(f.find((x) => x.id === 'fund')!.title).toMatch(/only 1\.0 months/);
  });
});

describe('new policies', () => {
  it('start empty with unique ids', () => {
    const a = newPolicy('life', 3);
    const b = newPolicy('life', 3);
    expect(a).toMatchObject({ type: 'life', personId: 3, coverageCents: 0, company: '' });
    expect(a.id).not.toBe(b.id);
  });
});
