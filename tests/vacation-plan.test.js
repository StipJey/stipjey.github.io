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
    budget: 28, minGap: 21, gapUnit: 'calendar', minPart: 5,
    minParts: 1, maxParts: 6, maxRestDays: 10,
    workYearStart: '2027-01-01', past14: true,
    weekendPolicy: 'allow', weekendRule: 'any', minWeekendDays: 0,
    blockedMonths: [], blockedRanges: [], manual: [], auto: [], avoided: [],
    ...overrides,
});

test('a four-day schedule skips holidays, transfers and exclusions without duplicating manual dates', () => {
    const january = planner.fourDayPlan(settings(), { dow: 5, from: 1, to: 1 });
    assert.equal(january.off, 1);
    assert.deepEqual(january.selected, [
        '2027-01-08', '2027-01-15', '2027-01-22', '2027-01-29',
    ]);

    const may = planner.fourDayPlan(settings({
        manual: ['2027-05-17'],
        blockedRanges: [{ from: '2027-05-17', to: '2027-05-24' }],
        avoided: ['2027-06-07'],
        blockedMonths: [6],
    }), { dow: 1, from: 5, to: 7 });
    assert.equal(may.off, 2);
    assert.deepEqual(may.existing, ['2027-05-17']);
    assert.equal(may.excluded, 6);
    assert.deepEqual(may.selected, [
        '2027-05-31', '2027-06-14', '2027-06-21', '2027-06-28',
    ]);
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

test('zero gap still requires a working separator from fixed manual dates', () => {
    const plan = settings({
        budget: 6, minGap: 0, manual: ['2027-08-10'],
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
    const plan = settings({ auto: ['2027-06-11', ...week] });
    assert.deepEqual(planner.retainedAuto(plan), week);
});

test('manual errors report the excess number of parts and the next possible date', () => {
    const plan = settings({
        budget: 2, manual: ['2027-08-10', '2027-08-31'],
    });
    assert.match(planner.manualProblem({ ...plan, maxParts: 1 }), /2 частей при максимуме 1/);
    assert.match(planner.manualProblem(plan), /20 полных.*21.*2027-09-01/);
    assert.equal(planner.manualProblem({ ...plan, manual: ['2027-08-10', '2027-09-01'] }), '');
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
