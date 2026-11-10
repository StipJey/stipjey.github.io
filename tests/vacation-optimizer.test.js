import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectRestPeriods,
    countGap,
    hasRequiredRestGap,
    optimizeIntervals,
} from '../src/lib/vacation-optimizer.js';

function candidate(startIndex, endIndex, score, extra = {}) {
    return {
        startIndex,
        endIndex,
        centerIndex: (startIndex + endIndex) / 2,
        startKey: `2027-${String(startIndex + 1).padStart(3, '0')}`,
        endKey: `2027-${String(endIndex + 1).padStart(3, '0')}`,
        leaveKeys: [`d${startIndex}`, `d${endIndex}`],
        cost: endIndex - startIndex + 1,
        score,
        has14DayPart: endIndex - startIndex + 1 >= 14,
        ...extra,
    };
}

function bruteForce(candidates, options) {
    let best = null;
    for (let mask = 0; mask < 2 ** candidates.length; mask++) {
        const chosen = candidates.filter((_, index) => mask & (1 << index));
        const ordered = [...chosen].sort((a, b) => a.startIndex - b.startIndex);
        const used = ordered.reduce((sum, item) => sum + item.cost, 0);
        if (used > options.budget) continue;
        if (ordered.length < options.minParts || ordered.length > options.maxParts) continue;
        if (options.requires14 && !options.hasCompleted14DayPart && !ordered.some((x) => x.has14DayPart)) continue;
        let compatible = true;
        for (let index = 1; index < ordered.length; index++) {
            const calendarGap = ordered[index].startIndex - ordered[index - 1].endIndex - 1;
            const prefix = ordered[index].workdayPrefix;
            const workdayGap = prefix
                ? prefix[ordered[index].startIndex] - prefix[ordered[index - 1].endIndex + 1]
                : calendarGap;
            const gap = options.gapUnit === 'working' ? workdayGap : calendarGap;
            if (gap < options.minGap ||
                (options.requireWorkdaySeparator && workdayGap < 1)) compatible = false;
        }
        if (!compatible) continue;
        const score = ordered.reduce((sum, item) => sum + item.score, 0);
        if (!best || score > best.score) best = { score, plan: ordered };
    }
    return best;
}

test('candidate input order does not affect the selected plan', () => {
    const candidates = [
        candidate(10, 13, 4),
        candidate(40, 53, 8),
        candidate(100, 113, 8),
        candidate(200, 204, 2),
    ];
    const options = { budget: 22, minParts: 1, maxParts: 3, yearLength: 365 };
    const a = optimizeIntervals(candidates, options);
    const b = optimizeIntervals([...candidates].reverse(), options);
    assert.deepEqual(a.plan.map((x) => x.key), b.plan.map((x) => x.key));
});

test('equal-score plans use a deterministic year-wide placement tie-break', () => {
    const candidates = [
        candidate(40, 53, 10),
        candidate(160, 173, 10),
        candidate(280, 293, 10),
    ];
    const result = optimizeIntervals(candidates, {
        budget: 28,
        minParts: 2,
        maxParts: 2,
        requires14: true,
        yearLength: 365,
    });
    assert.equal(result.status, 'optimal');
    assert.deepEqual(result.plan.map((x) => x.startIndex), [40, 280]);
});

test('the mandatory-period exception prefers fewer weekend leave days', () => {
    const withFourOffDays = candidate(0, 13, 20, {
        priority: 30,
        offDays: 4,
        has14DayPart: true,
    });
    const withTwoOffDays = candidate(40, 53, 18, {
        priority: 25,
        offDays: 2,
        has14DayPart: true,
    });
    const options = {
        budget: 14,
        minParts: 1,
        maxParts: 1,
        requires14: true,
        minimizeOffDays: true,
    };

    const result = optimizeIntervals([withFourOffDays, withTwoOffDays], options);

    assert.equal(result.status, 'optimal');
    assert.equal(result.plan[0].offDays, 2);
    assert.equal(result.offDays, 2);
});

test('spread compares weekend leave across different part counts', () => {
    const onePart = candidate(0, 15, 50, { offDays: 4 });
    const longPart = candidate(40, 53, 10, { offDays: 3 });
    const shortPart = candidate(70, 71, 10);
    const options = {
        budget: 16, minParts: 1, maxParts: 2, yearLength: 365,
        minimizeOffDays: true, preferCoverage: true,
    };
    const candidates = [onePart, longPart, shortPart];
    const result = optimizeIntervals(candidates, options);
    assert.deepEqual(result.plan.map((item) => item.startIndex), [40, 70]);
    assert.equal(result.offDays, 3);

    const empty = optimizeIntervals([longPart], {
        ...options, minParts: 0, requires14: false, preferCoverage: false,
    });
    assert.deepEqual(empty.plan, []);
    assert.equal(empty.offDays, 0);
});

test('excludes entire plans while keeping their periods available for alternatives', () => {
    const first = candidate(0, 0, 9);
    const earlier = candidate(5, 5, 5);
    const later = candidate(6, 6, 4);
    const candidates = [first, earlier, later];
    const options = {
        budget: 2, minParts: 2, maxParts: 2, minGap: 2, requires14: false,
    };

    const best = optimizeIntervals(candidates, options);
    const next = optimizeIntervals(candidates, { ...options, excludedPlans: [best.plan] });
    assert.deepEqual(best.plan.map((item) => item.startIndex), [0, 5]);
    assert.deepEqual(next.plan.map((item) => item.startIndex), [0, 6]);
    assert.equal(optimizeIntervals(candidates, {
        ...options, excludedPlans: [best.plan, next.plan],
    }).status, 'infeasible');
});

test('calendar minimum gap is enforced between intervals', () => {
    const result = optimizeIntervals(
        [candidate(10, 23, 9), candidate(35, 48, 9)],
        { budget: 28, minParts: 2, maxParts: 2, minGap: 21, yearLength: 365 },
    );
    assert.equal(result.status, 'infeasible');
});

test('the 21-day minimum gap is measured between rest-period boundaries', () => {
    const first = candidate(0, 4, 5, {
        restStartIndex: 0,
        restEndIndex: 4,
        restLength: 5,
        has14DayPart: false,
    });
    const exactly21Days = candidate(26, 30, 5, {
        restStartIndex: 26,
        restEndIndex: 30,
        restLength: 5,
        has14DayPart: false,
    });
    const only20Days = { ...exactly21Days, restStartIndex: 25 };
    const options = {
        budget: 10,
        minParts: 2,
        maxParts: 2,
        minGap: 21,
        requires14: false,
        yearLength: 365,
    };
    assert.equal(optimizeIntervals([first, exactly21Days], options).status, 'optimal');
    assert.equal(optimizeIntervals([first, only20Days], options).status, 'infeasible');
});

test('automatic rest periods over ten days require the legal 14-day part exception', () => {
    const overLimit = candidate(0, 10, 5, {
        restStartIndex: 0,
        restEndIndex: 10,
        restLength: 11,
        has14DayPart: false,
    });
    const legalFourteen = candidate(0, 13, 14, {
        restStartIndex: 0,
        restEndIndex: 15,
        restLength: 16,
        cost: 14,
        has14DayPart: true,
    });
    const options = {
        budget: 14,
        minParts: 1,
        maxParts: 1,
        requires14: false,
        maxRestDays: 10,
        yearLength: 365,
    };
    assert.equal(optimizeIntervals([overLimit], options).status, 'infeasible');
    assert.equal(optimizeIntervals([legalFourteen], options).status, 'optimal');
});

test('working-day gap excludes weekends and statutory holidays from the count', () => {
    const days = Array.from({ length: 10 }, (_, index) => ({
        isWorkingDay: index === 1 || index === 2 || index === 4 || index === 7,
    }));
    assert.equal(countGap(days, 7, 1, 'calendar'), 5);
    assert.equal(countGap(days, 7, 1, 'working'), 2);
});

test('leave parts separated only by weekends are allowed by default', () => {
    const days = [true, false, false, true].map((isWorkingDay, index) => ({
        isWorkingDay,
        key: `d${index}`,
    }));
    const prefix = [0];
    for (const day of days) prefix.push(prefix.at(-1) + Number(day.isWorkingDay));
    const result = optimizeIntervals(
        [candidate(0, 0, 1, { cost: 1, has14DayPart: false }),
            candidate(3, 3, 1, { cost: 1, has14DayPart: false, workdayPrefix: prefix })],
        { budget: 2, minParts: 2, maxParts: 2, minGap: 0, gapUnit: 'working', requires14: false, yearLength: 4 },
    );
    assert.equal(result.status, 'optimal');
    assert.deepEqual(result.plan.map((item) => item.startIndex), [0, 3]);
});

test('Friday and Monday can bridge a weekend as two paid days in one rest run', () => {
    const workdayPrefix = [0, 1, 1, 1, 2];
    const result = optimizeIntervals(
        [candidate(0, 3, 4, {
            cost: 2,
            partCount: 2,
            leaveKeys: ['friday', 'monday'],
            has14DayPart: false,
            workdayPrefix,
        })],
        { budget: 2, minParts: 2, maxParts: 2, minGap: 0, requires14: false },
    );
    assert.equal(result.status, 'optimal');
    assert.equal(result.plan[0].cost, 2);
    assert.deepEqual(result.plan[0].leaveKeys, ['friday', 'monday']);
});

test('Friday and Monday show four consecutive rest days with two leave days', () => {
    const days = [
        { key: 'fri', off: false },
        { key: 'sat', off: true },
        { key: 'sun', off: true },
        { key: 'mon', off: false },
    ];
    const periods = collectRestPeriods(days, new Set(['fri', 'mon']));
    assert.deepEqual(periods, [{ start: 'fri', end: 'mon', len: 4, leaves: 2 }]);
});

test('three days off, four leave days, and three days off form a ten-day rest period', () => {
    const days = Array.from({ length: 10 }, (_, index) => ({
        key: `day-${index}`,
        off: index < 3 || index >= 7,
    }));
    const selected = new Set(days.slice(3, 7).map((day) => day.key));
    assert.deepEqual(collectRestPeriods(days, selected), [
        { start: 'day-0', end: 'day-9', len: 10, leaves: 4 },
    ]);
});

test('automatic periods cannot overlap a manual rest period, even with a zero gap setting', () => {
    const days = Array.from({ length: 5 }, (_, index) => ({
        isWorkingDay: index === 0 || index === 3 || index === 4,
    }));
    const manualEnd = 2;
    const autoStart = 1;
    assert.equal(hasRequiredRestGap(days, manualEnd, autoStart, 0), false);
});

test('a pre-completed 14-day part satisfies the constraint', () => {
    const result = optimizeIntervals([candidate(20, 24, 5)], {
        budget: 5,
        minParts: 1,
        maxParts: 1,
        requires14: true,
        hasCompleted14DayPart: true,
        yearLength: 365,
    });
    assert.equal(result.status, 'optimal');
});

test('the exact solver matches exhaustive search on seeded small calendars', () => {
    let seed = 297;
    const random = () => {
        seed = (seed * 48271) % 2147483647;
        return seed / 2147483647;
    };
    for (let sample = 0; sample < 60; sample++) {
        const candidates = [];
        for (let index = 0; index < 9; index++) {
            const start = Math.floor(random() * 25);
            const length = 1 + Math.floor(random() * 5);
            candidates.push(candidate(start, start + length - 1, Math.floor(random() * 9), {
                cost: length,
                has14DayPart: length >= 4,
            }));
        }
        const options = {
            budget: 10,
            minParts: 1,
            maxParts: 3,
            minGap: sample % 3,
            requireWorkdaySeparator: false,
            requires14: sample % 2 === 0,
            yearLength: 30,
        };
        const actual = optimizeIntervals(candidates, options);
        const expected = bruteForce(candidates, options);
        assert.equal(actual.status, expected ? 'optimal' : 'infeasible');
        if (expected) assert.equal(actual.score, expected.score);
    }
});
