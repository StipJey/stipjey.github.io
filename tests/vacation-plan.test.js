import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacationPlanner } from '../src/lib/vacation-plan.js';
import { optimizeIntervals } from '../src/lib/vacation-optimizer.js';

const calendar = Array.from({ length: 365 }, (_, i) => {
    const date = new Date(Date.UTC(2027, 0, i + 1));
    const key = date.toISOString().slice(0, 10);
    const dow = date.getUTCDay();
    const holiday = ['2027-01-01', '2027-05-01', '2027-05-09'].includes(key);
    const transferred = ['2027-05-03', '2027-05-10'].includes(key);
    const off = dow === 0 || dow === 6 || holiday || transferred;
    return {
        i, key, dow, m: date.getUTCMonth(), holiday, off,
        work: !off, isWorkingDay: !off,
    };
});
const planner = createVacationPlanner(calendar, (key) => key);
const dates = (from, to) => calendar.filter(({ key }) => from <= key && key <= to)
    .map(({ key }) => key);
const settings = (overrides = {}) => ({
    budget: 28, minGap: 10, gapUnit: 'working', minPart: 1,
    minParts: 1, maxParts: 6, maxRestDays: 10,
    workYearStart: '2027-01-01', past14: true,
    weekendPolicy: 'allow', weekendRule: 'any', minWeekendDays: 0,
    blockedMonths: [], blockedRanges: [], manual: [], auto: [], avoided: [],
    ...overrides,
});

test('the short-week selector supports multiple weekdays and ignores automatic-only exclusions', () => {
    const may = planner.fourDayPlan(settings({
        manual: ['2027-05-17'],
        auto: ['2027-05-07'],
        blockedRanges: [{ from: '2027-05-17', to: '2027-05-24' }],
        avoided: ['2027-05-31'],
        blockedMonths: [4],
    }), { dows: [1, 4, 5], from: 5, to: 5 });
    assert.deepEqual(may.existing, ['2027-05-17']);
    assert.equal(may.excluded, 2);
    assert.deepEqual(may.selected, [
        '2027-05-06', '2027-05-07', '2027-05-13', '2027-05-14',
        '2027-05-20', '2027-05-21',
        '2027-05-24', '2027-05-27', '2027-05-28', '2027-05-31',
    ]);
    assert.equal(may.fits, true);
    assert.equal(may.needsManualReset, false);
});

test('the short-week application replaces old manual dates when only the proposed days fit', () => {
    const plan = planner.fourDayPlan(settings({
        budget: 4,
        manual: ['2027-06-04', '2027-08-10'],
        auto: ['2027-10-04'],
    }), { dows: [5], from: 6, to: 6 });
    assert.deepEqual(plan.existing, ['2027-06-04']);
    assert.deepEqual(plan.selected, ['2027-06-11', '2027-06-18', '2027-06-25']);
    assert.equal(plan.required, 4);
    assert.equal(plan.fits, true);
    assert.equal(plan.needsManualReset, true);
});

test('the short-week application rejects a proposed schedule larger than the budget', () => {
    const plan = planner.fourDayPlan(settings({ budget: 2 }), {
        dows: [5], from: 6, to: 6,
    });
    assert.equal(plan.required, 4);
    assert.equal(plan.fits, false);
});

test('the minimum applies to each paid part, even inside one rest period', () => {
    const blockedRanges = [
        { from: '2027-01-01', to: '2027-06-10' },
        { from: '2027-06-16', to: '2027-12-31' },
    ];
    const plan = settings({ budget: 3, minPart: 3, blockedRanges });
    const candidates = planner.candidatesFor(plan);
    assert.ok(!candidates.some(({ leaveKeys }) =>
        leaveKeys.join() === '2027-06-11,2027-06-14,2027-06-15',
    ));
    const shorter = planner.candidatesFor({ ...plan, minPart: 1 });
    assert.ok(shorter.some(({ leaveKeys, partCount }) =>
        partCount === 2 && leaveKeys.join() === '2027-06-11,2027-06-14,2027-06-15',
    ));
});

test('combines two leave parts separated by transferred and official holidays', () => {
    const february = calendar.map((day) => {
        if (day.key === '2027-02-22') return { ...day, off: true, work: false, isWorkingDay: false };
        if (day.key === '2027-02-23') return { ...day, holiday: true, off: true, work: false, isWorkingDay: false };
        return day;
    });
    const februaryPlanner = createVacationPlanner(february, (key) => key);
    const plan = settings({
        budget: 15, minGap: 0, gapUnit: 'calendar', minPart: 1,
        minParts: 2, maxParts: 2, maxRestDays: 10, past14: false,
        blockedRanges: [
            { from: '2027-01-01', to: '2027-02-07' },
            { from: '2027-02-25', to: '2027-12-31' },
        ],
    });
    const selected = [
        ...dates('2027-02-08', '2027-02-21'), '2027-02-24',
    ];
    const candidates = februaryPlanner.candidatesFor(plan);
    const candidate = candidates.find((item) =>
        item.leaveKeys.join() === selected.join(),
    );

    assert.ok(candidate);
    assert.equal(candidate.partCount, 2);
    assert.equal(candidate.has14DayPart, true);
    assert.equal(candidate.restLength, 19);
    assert.equal(februaryPlanner.validate(plan, selected), '');
    const solved = optimizeIntervals(
        candidates.map((item) => ({ ...item, score: item.cost })),
        februaryPlanner.solverOptions(plan, []),
    );
    assert.equal(solved.status, 'optimal');
    assert.equal(solved.used, 15);
    assert.equal(solved.plan.reduce((sum, item) => sum + item.partCount, 0), 2);
});

test('zero gap still requires a working separator from fixed manual dates', () => {
    const plan = settings({
        budget: 6, minGap: 0, minPart: 5, manual: ['2027-08-10'],
        blockedRanges: [
            { from: '2027-01-01', to: '2027-08-10' },
            { from: '2027-08-16', to: '2027-10-03' },
            { from: '2027-10-09', to: '2027-12-31' },
        ],
    });
    const candidates = planner.candidatesFor(plan);
    assert.deepEqual(candidates.map((candidate) => candidate.leaveKeys), [
        dates('2027-10-04', '2027-10-08'),
    ]);
});

test('old plans retain compatible automatic periods when a different period is invalid', () => {
    const october = dates('2027-10-04', '2027-10-08');
    const plan = settings({
        manual: ['2027-08-10'],
        auto: [...dates('2027-08-11', '2027-08-15'), ...october],
    });
    assert.deepEqual(planner.retainedAuto(plan), october);
    assert.equal(planner.validate(plan, october), '');
});

test('a short saved part does not remove a valid part connected by a weekend', () => {
    const week = dates('2027-06-14', '2027-06-18');
    const plan = settings({ minPart: 5, auto: ['2027-06-11', ...week] });
    assert.deepEqual(planner.retainedAuto(plan), week);
});

test('saved automatic plans discard a leave part made only of weekend days', () => {
    const plan = settings({
        budget: 3,
        past14: true,
        minGap: 0,
        auto: ['2027-06-12', '2027-06-13', '2027-06-15'],
    });

    assert.deepEqual(planner.retainedAuto(plan), ['2027-06-15']);
    assert.notEqual(planner.validate(plan, plan.auto), '');
});

test('manual dates are exempt from configured part-count and gap validation', () => {
    const plan = settings({
        budget: 2, manual: ['2027-08-10', '2027-08-31'],
    });
    assert.equal(planner.manualProblem({ ...plan, maxParts: 1 }), '');
    assert.equal(planner.manualProblem(plan), '');
    assert.equal(planner.validate(plan, []), '');
});

test('different strategy scores still use the largest feasible share of the budget', () => {
    const blockedRanges = [
        { from: '2027-01-01', to: '2027-08-01' },
        { from: '2027-08-07', to: '2027-09-05' },
        { from: '2027-09-11', to: '2027-12-31' },
    ];
    const plan = settings({ budget: 10, blockedRanges });
    const candidates = planner.candidatesFor(plan).map((item) => ({ ...item, score: -10 }));
    const result = optimizeIntervals(candidates, planner.solverOptions(plan, []));
    assert.equal(result.used, 10);
    assert.equal(planner.validate(plan, result.plan.flatMap((item) => item.leaveKeys)), '');
});
