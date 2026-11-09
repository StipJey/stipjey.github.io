import {
    collectRestPeriods,
    countGap,
    hasRequiredRestGap,
    optimizeIntervals,
} from './vacation-optimizer.js';

export function createVacationPlanner(days, humanDate) {
    const byKey = new Map(days.map((day) => [day.key, day]));
    const workdayPrefix = [0];
    const left = [];
    const right = [];
    for (const day of days) {
        workdayPrefix.push(workdayPrefix.at(-1) + Number(day.work));
        left[day.i] = days[day.i - 1]?.off ? left[day.i - 1] : day.i;
    }
    for (const day of [...days].reverse()) {
        right[day.i] = days[day.i + 1]?.off ? right[day.i + 1] : day.i;
    }

    function splitParts(leave) {
        const parts = [];
        for (const day of leave) {
            const last = parts.at(-1);
            const previous = last?.items.at(-1);
            if (previous && days.slice(previous.i + 1, day.i).every((item) => item.holiday)) {
                last.end = day.key;
                last.items.push(day);
            } else {
                parts.push({ start: day.key, end: day.key, items: [day] });
            }
        }
        return parts;
    }

    function partsFor(selection) {
        return splitParts(days.filter((day) => selection.has(day.key)));
    }

    function has14(parts, settings) {
        if (!parts.some((part) => part.items.length >= 14)) return false;
        const end = new Date(settings.workYearStart + 'T00:00:00Z');
        end.setUTCFullYear(end.getUTCFullYear() + 1);
        if (!Number.isFinite(end.getTime())) return false;
        const endKey = end.toISOString().slice(0, 10);
        return parts.some((part) =>
            part.items.length >= 14 &&
            part.start >= settings.workYearStart && part.end < endKey
        );
    }

    function runBounds(run) {
        return {
            restStartIndex: byKey.get(run.start).i,
            restEndIndex: byKey.get(run.end).i,
        };
    }

    function separated(previousEnd, nextStart, settings) {
        return hasRequiredRestGap(
            days, previousEnd, nextStart, settings.minGap, settings.gapUnit,
        ) && workdayPrefix[nextStart] > workdayPrefix[previousEnd + 1];
    }

    function compatible(a, b, settings) {
        return a.restStartIndex < b.restStartIndex
            ? separated(a.restEndIndex, b.restStartIndex, settings)
            : separated(b.restEndIndex, a.restStartIndex, settings);
    }

    function gapProblem(runs, settings) {
        for (let index = 1; index < runs.length; index++) {
            const previous = runs[index - 1];
            const next = runs[index];
            const { restEndIndex } = runBounds(previous);
            const { restStartIndex } = runBounds(next);
            if (separated(restEndIndex, restStartIndex, settings)) continue;
            const actual = countGap(days, restStartIndex, restEndIndex, settings.gapUnit);
            const unit = settings.gapUnit === 'working' ? 'рабочих' : 'календарных';
            const earliest = days.slice(restStartIndex + 1).find(
                (day) => day.work && separated(restEndIndex, left[day.i], settings),
            );
            return `Между периодами (${humanDate(previous.end)} и ${humanDate(next.start)}) ` +
                `${actual} полных ${unit} дн. Нужно ${settings.minGap}.` +
                (earliest ? ` Ближайшая дата для начала отпуска — ${humanDate(earliest.key)}.` : '');
        }
        return '';
    }

    function manualProblem(settings) {
        if (settings.manual.length > settings.budget) {
            return `Вручную выбрано ${settings.manual.length} дн. при бюджете ${settings.budget}. ` +
                'Увеличьте бюджет или снимите выбор с лишних дат.';
        }
        const manual = new Set(settings.manual);
        const count = partsFor(manual).length;
        if (count > settings.maxParts) {
            return `Вручную выбрано ${count} частей при максимуме ${settings.maxParts}. ` +
                'Увеличьте максимум или измените ручные даты.';
        }
        return gapProblem(collectRestPeriods(days, manual), settings);
    }

    function allowsPart(part, settings) {
        const { items } = part;
        if (items.length < settings.minPart) return false;
        const off = items.filter((day) => day.off);
        if (settings.weekendPolicy === 'require' && !off.length) return false;
        switch (settings.weekendRule) {
            case 'pair':
                return off.some((day, index) => day.dow === 6 && off[index + 1]?.i === day.i + 1);
            case 'week':
                return items[0].dow === 1 && items.at(-1).i - items[0].i === 6;
            case 'friday':
                return items.at(-1).dow !== 5;
            case 'custom':
                return off.length >= settings.minWeekendDays;
            default:
                return true;
        }
    }

    function describeCandidate(leave, bounds, manualBounds, settings) {
        if (!leave.some((day) => day.work)) return null;
        const fitsManual = manualBounds.every((fixed) => compatible(bounds, fixed, settings));
        if (!fitsManual) return null;
        const parts = splitParts(leave);
        if (!parts.every((part) => allowsPart(part, settings))) return null;
        const first = leave[0];
        const last = leave.at(-1);
        const restLength = bounds.restEndIndex - bounds.restStartIndex + 1;
        const has14DayPart = has14(parts, settings);
        if (restLength > settings.maxRestDays && !has14DayPart) return null;
        return {
            ...bounds, restLength, has14DayPart, workdayPrefix,
            leaveKeys: leave.map((day) => day.key),
            startIndex: first.i, endIndex: last.i,
            startKey: first.key, endKey: last.key, cost: leave.length,
            centerIndex: (first.i + last.i) / 2, partCount: parts.length,
            parts,
        };
    }

    function autoExcluded(day, settings) {
        return settings.avoided.includes(day.key) ||
            settings.blockedMonths.includes(day.m) ||
            settings.blockedRanges.some((range) => range.from <= day.key && day.key <= range.to);
    }

    function fourDayPlan(settings, { dow, from, to }) {
        const manual = new Set(settings.manual);
        const matches = days.filter((day) =>
            day.dow === dow && day.m >= from - 1 && day.m <= to - 1,
        );
        const working = matches.filter((day) => day.work);
        const existing = working.filter((day) => manual.has(day.key));
        const available = working.filter((day) =>
            !manual.has(day.key) && !autoExcluded(day, settings),
        );
        const fits = manual.size + available.length <= settings.budget;
        return {
            selected: fits ? available.map((day) => day.key) : [],
            requested: available.length,
            existing: existing.map((day) => day.key),
            off: matches.length - working.length,
            excluded: working.length - existing.length - available.length,
            fits,
        };
    }

    function solverOptions(settings, manualParts) {
        return {
            budget: settings.budget - settings.manual.length,
            minParts: Math.max(0, settings.minParts - manualParts.length),
            maxParts: Math.max(0, settings.maxParts - manualParts.length),
            requires14: settings.budget > 0,
            hasCompleted14DayPart: settings.past14 || has14(manualParts, settings),
            minGap: settings.minGap,
            gapUnit: settings.gapUnit,
            maxRestDays: settings.maxRestDays,
            requireWorkdaySeparator: true,
            preferCoverage: true,
        };
    }

    function candidatesFor(settings) {
        const manual = new Set(settings.manual);
        const manualBounds = collectRestPeriods(days, manual).map(runBounds);
        const remaining = settings.budget - manual.size;
        const candidates = [];
        if (remaining < settings.minPart) return candidates;

        const forbidden = days.map((day) => manual.has(day.key) || autoExcluded(day, settings));
        const seen = new Set();
        for (const workdaysOnly of [false, true]) {
            for (const first of days) {
                if (first.holiday || (workdaysOnly && !first.work)) continue;
                const leave = [];
                for (let index = first.i; index < days.length; index++) {
                    const day = days[index];
                    if (day.holiday || (workdaysOnly && !day.work)) continue;
                    if (forbidden[index]) break;
                    leave.push(day);
                    if (leave.length > remaining) break;
                    if (leave.length < settings.minPart) continue;
                    const candidate = describeCandidate(leave, {
                        restStartIndex: left[first.i], restEndIndex: right[index],
                    }, manualBounds, settings);
                    if (!candidate) continue;
                    const signature = candidate.leaveKeys.join(',');
                    if (seen.has(signature)) continue;
                    seen.add(signature);
                    candidates.push(candidate);
                }
            }
        }
        return candidates;
    }

    function retainedAuto(settings) {
        if (!settings.auto.length) return [];
        const manual = new Set(settings.manual);
        const manualBounds = collectRestPeriods(days, manual).map(runBounds);
        const permittedDates = new Set(settings.auto.filter((key) =>
            byKey.has(key) && !byKey.get(key).holiday && !manual.has(key) &&
            !autoExcluded(byKey.get(key), settings),
        ));
        const selection = new Set(partsFor(permittedDates)
            .filter((part) => allowsPart(part, settings))
            .flatMap((part) => part.items.map((day) => day.key)));
        const candidates = collectRestPeriods(days, selection).flatMap((run) => {
            const bounds = runBounds(run);
            const leave = days.slice(bounds.restStartIndex, bounds.restEndIndex + 1)
                .filter((day) => selection.has(day.key));
            const candidate = describeCandidate(leave, bounds, manualBounds, settings);
            return candidate ? [{ ...candidate, score: candidate.cost }] : [];
        });
        const options = { ...solverOptions(settings, partsFor(manual)), minParts: 0 };
        // An incomplete old plan can still contain individually valid periods.
        const legal = optimizeIntervals(candidates, options);
        const best = legal.status === 'optimal' ? legal : optimizeIntervals(candidates, {
            ...options, requires14: false,
        });
        return best.plan.flatMap((candidate) => candidate.leaveKeys).sort();
    }

    function validate(settings, auto) {
        const manualError = manualProblem(settings);
        if (manualError) return manualError;
        const all = [...settings.manual, ...auto];
        const unique = new Set(all);
        if (unique.size !== all.length || all.length > settings.budget) {
            return 'Даты повторяются или превышают бюджет.';
        }
        const parts = partsFor(unique);
        if (parts.length < settings.minParts || parts.length > settings.maxParts) {
            return `Нужно от ${settings.minParts} до ${settings.maxParts} частей отпуска.`;
        }
        if (retainedAuto({ ...settings, auto }).length !== auto.length) {
            return 'Автоматические даты нарушают ограничения подбора.';
        }
        const intervalError = gapProblem(collectRestPeriods(days, unique), settings);
        if (intervalError) return intervalError;
        if (settings.budget > 0 && !settings.past14 && !has14(parts, settings)) {
            return 'Не найдена непрерывная часть из 14 отпускных дней в заданном рабочем году.';
        }
        return '';
    }

    return {
        partsFor, has14, gapProblem, manualProblem, candidatesFor,
        retainedAuto, solverOptions, validate, compatible, fourDayPlan,
    };
}
