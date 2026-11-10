const EPSILON = 1e-9;

const stableKey = (candidate) =>
    `${candidate.startKey}/${candidate.endKey}/${candidate.leaveKeys.join(',')}`;

function betterPlan(candidate, current, minimizeOffDays = false) {
    if (!current) return true;
    if (minimizeOffDays && candidate.offDays !== current.offDays) {
        return candidate.offDays < current.offDays;
    }
    if (candidate.priority !== current.priority) {
        return candidate.priority > current.priority;
    }
    if (candidate.score > current.score + EPSILON) return true;
    if (candidate.score < current.score - EPSILON) return false;
    if (candidate.spreadScore > current.spreadScore + EPSILON) return true;
    if (candidate.spreadScore < current.spreadScore - EPSILON) return false;
    return candidate.key < current.key;
}

const stateKey = (used, parts, has14) => `${used}:${parts}:${Number(has14)}`;

/**
 * Exact interval dynamic program for an additive priority and score.
 * Candidate utilities must be independent of other selected intervals. Hard
 * constraints (budget, part count, overlap/gap, and the 14-day requirement)
 * are enforced by the recurrence.
 */
function optimizeForPartCount(candidates, options, excludedKeys, excludedPrefixes) {
    const {
        budget,
        minParts = 1,
        maxParts = 6,
        requires14 = true,
        hasCompleted14DayPart = false,
        minGap = 0,
        gapUnit = 'calendar',
        requireWorkdaySeparator = false,
        maxRestDays = Infinity,
        yearLength,
        spreadWeight = 0,
        preferCoverage = false,
        minimizeOffDays = false,
        targetParts = maxParts,
    } = options;

    const safeCandidates = candidates
        .filter((candidate) => {
            const validInterval =
                Number.isInteger(candidate.cost) &&
                candidate.cost > 0 &&
                candidate.cost <= budget &&
                candidate.startIndex <= candidate.endIndex;
            const restLength =
                candidate.restLength ??
                (candidate.endIndex - candidate.startIndex + 1);
            return validInterval &&
                (restLength <= maxRestDays || candidate.has14DayPart);
        })
        .map((candidate) => ({ ...candidate, key: stableKey(candidate) }))
        .sort((a, b) =>
            (a.restEndIndex ?? a.endIndex) - (b.restEndIndex ?? b.endIndex) ||
            (a.restStartIndex ?? a.startIndex) - (b.restStartIndex ?? b.startIndex) ||
            a.key.localeCompare(b.key),
        );

    if ((!safeCandidates.length || budget <= 0 || maxParts <= 0) && minParts === 0 &&
        (!requires14 || hasCompleted14DayPart) && !excludedKeys.has('')) {
        return { status: 'optimal', plan: [], priority: 0, score: 0, spreadScore: 0, used: 0, offDays: 0, key: '' };
    }
    if (!safeCandidates.length || budget <= 0 || maxParts <= 0) {
        return { status: 'infeasible', plan: [], score: -Infinity };
    }

    const gapLimit = safeCandidates.map((candidate) => {
        const prefix = candidate.workdayPrefix;
        const restStart = candidate.restStartIndex ?? candidate.startIndex;
        for (let previousEnd = restStart - 1; previousEnd >= -1; previousEnd--) {
            const calendarGap = restStart - previousEnd - 1;
            const workdayGap = prefix
                ? prefix[restStart] - prefix[previousEnd + 1]
                : calendarGap;
            const configuredGap = gapUnit === 'calendar' ? calendarGap : workdayGap;
            if (configuredGap >= minGap &&
                (!requireWorkdaySeparator || workdayGap >= 1)) return previousEnd;
        }
        return -2;
    });

    const groups = new Map();
    safeCandidates.forEach((candidate, index) => {
        const end = candidate.restEndIndex ?? candidate.endIndex;
        const group = groups.get(end) || [];
        group.push({ candidate, index });
        groups.set(end, group);
    });

    const endDates = [...groups.keys()].sort((a, b) => a - b);
    const prefixStates = [];
    let cumulative = new Map();
    cumulative.set(stateKey(0, 0, false), {
        used: 0,
        parts: 0,
        has14: false,
        priority: 0,
        offDays: 0,
        score: 0,
        spreadScore: 0,
        plan: [],
        key: '',
    });
    prefixStates.push({ end: -1, states: cumulative });

    for (const end of endDates) {
        const groupStates = new Map();
        for (const { candidate, index } of groups.get(end)) {
            const limit = gapLimit[index];
            let prefixIndex = 0;
            for (let i = prefixStates.length - 1; i > 0; i--) {
                if (prefixStates[i].end <= limit) {
                    prefixIndex = i;
                    break;
                }
            }
            const sources = prefixStates[prefixIndex].states;

            for (const source of sources.values()) {
                const used = source.used + candidate.cost;
                const parts = source.parts + (candidate.partCount ?? 1);
                if (used > budget || parts > maxParts) continue;
                const has14 = source.has14 || candidate.has14DayPart;
                const spread = yearLength
                    ? -Math.pow(
                          (candidate.centerIndex + 0.5) / yearLength -
                              (parts - 0.5) / Math.max(1, targetParts),
                          2,
                      )
                    : 0;
                const next = {
                    used,
                    parts,
                    has14,
                    priority: source.priority + (candidate.priority ?? 0),
                    offDays: source.offDays + (candidate.offDays ?? 0),
                    score: source.score + candidate.score + spreadWeight * spread,
                    spreadScore: source.spreadScore + spread,
                    plan: [...source.plan, candidate],
                    key: source.key ? `${source.key}|${candidate.key}` : candidate.key,
                };
                // Keep prefixes of excluded plans separate so they cannot
                // displace a viable alternative with the same state.
                const baseKey = stateKey(used, parts, has14);
                const key = excludedPrefixes.has(next.key)
                    ? `${baseKey}:${next.key}`
                    : baseKey;
                if (betterPlan(next, groupStates.get(key), minimizeOffDays)) groupStates.set(key, next);
            }
        }

        const merged = new Map(cumulative);
        for (const [key, state] of groupStates) {
            if (betterPlan(state, merged.get(key), minimizeOffDays)) merged.set(key, state);
        }
        cumulative = merged;
        prefixStates.push({ end, states: cumulative });
    }

    let best = null;
    for (const state of cumulative.values()) {
        if (state.parts < minParts || state.parts > maxParts) continue;
        if (requires14 && !hasCompleted14DayPart && !state.has14) continue;
        if (excludedKeys.has(state.key)) continue;
        if (betterFinalPlan(state, best, preferCoverage, minimizeOffDays)) best = state;
    }
    if (!best) return { status: 'infeasible', plan: [], score: -Infinity };
    return {
        status: 'optimal',
        plan: best.plan,
        priority: best.priority,
        score: best.score,
        spreadScore: best.spreadScore,
        used: best.used,
        offDays: best.offDays,
        key: best.key,
    };
}

function betterFinalPlan(candidate, current, preferCoverage, minimizeOffDays = false) {
    if (current && preferCoverage && candidate.used !== current.used) {
        return candidate.used > current.used;
    }
    return betterPlan(candidate, current, minimizeOffDays);
}

export function optimizeIntervals(candidates, options) {
    const minParts = Math.max(0, options.minParts ?? 1);
    const maxParts = Math.max(minParts, options.maxParts ?? 6);
    const excludedKeys = new Set();
    const excludedPrefixes = new Set();
    for (const plan of options.excludedPlans ?? []) {
        const keys = plan.map(stableKey);
        excludedKeys.add(keys.join('|'));
        for (let length = 1; length <= keys.length; length++) {
            excludedPrefixes.add(keys.slice(0, length).join('|'));
        }
    }
    if (!options.yearLength) {
        return optimizeForPartCount(
            candidates, { ...options, minParts, maxParts }, excludedKeys, excludedPrefixes,
        );
    }
    let best = null;
    for (let targetParts = minParts; targetParts <= maxParts; targetParts++) {
        const result = optimizeForPartCount(candidates, {
            ...options,
            minParts: targetParts,
            maxParts: targetParts,
            targetParts,
        }, excludedKeys, excludedPrefixes);
        if (result.status !== 'optimal') continue;
        if (betterFinalPlan(result, best, options.preferCoverage, options.minimizeOffDays)) {
            best = result;
        }
    }
    return best || { status: 'infeasible', plan: [], score: -Infinity };
}

export function countGap(days, startIndex, endIndex, unit = 'calendar') {
    if (unit === 'calendar') return Math.max(0, startIndex - endIndex - 1);
    let count = 0;
    for (let index = endIndex + 1; index < startIndex; index++) {
        if (days[index]?.isWorkingDay) count++;
    }
    return count;
}

export function hasRequiredRestGap(
    days,
    previousEndIndex,
    nextStartIndex,
    minGap,
    unit = 'calendar',
) {
    return nextStartIndex > previousEndIndex &&
        countGap(days, nextStartIndex, previousEndIndex, unit) >= minGap;
}

export function collectRestPeriods(days, selected) {
    const periods = [];
    let current = null;
    for (const day of days) {
        if (day.off || selected.has(day.key)) {
            if (!current) {
                current = { start: day.key, end: day.key, len: 0, leaves: 0 };
            }
            current.end = day.key;
            current.len++;
            if (selected.has(day.key)) current.leaves++;
        } else if (current) {
            if (current.leaves) periods.push(current);
            current = null;
        }
    }
    if (current?.leaves) periods.push(current);
    return periods;
}
