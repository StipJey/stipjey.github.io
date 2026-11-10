import { expect, test } from '@playwright/test';

const vacationPage = '/tools/vacation-2027/';
const vacationArticle = encodeURI('/blog/когда-выгодно-брать-отпуск-в-2027-году/');
const storageKey = 'vakation27:v3';

test.beforeEach(async ({ page, baseURL }) => {
    const origin = new URL(baseURL).origin;
    await page.route('**/*', (route) => {
        const requestOrigin = new URL(route.request().url()).origin;
        return requestOrigin === origin ? route.continue() : route.abort();
    });
});

async function openCalendar(page, savedPlan) {
    if (savedPlan) {
        await page.addInitScript(
            ({ key, plan }) => {
                if (localStorage.getItem(key) === null) {
                    localStorage.setItem(key, JSON.stringify(plan));
                }
            },
            { key: storageKey, plan: savedPlan }
        );
    }
    await page.goto(vacationPage);
    await expect(page.locator('[data-date="2027-01-01"]')).toBeVisible();
}

function day(page, isoDate) {
    return page.locator(`[data-date="${isoDate}"]`);
}

async function selectedDates(page, selection) {
    return page
        .locator(`.selected-${selection}[data-date]`)
        .evaluateAll((days) =>
            days.map((day) => day.getAttribute('data-date'))
        );
}

async function selectRange(page, start, end) {
    await page.getByText('Выбрать диапазон', { exact: true }).click();
    await page.getByLabel('Начало отпуска', { exact: true }).fill(start);
    await page.getByLabel('Конец отпуска', { exact: true }).fill(end);
    await page.getByRole('button', { name: 'Добавить даты вручную' }).click();
}

test('does not validate manually selected intervals and preserves them on budget edits', async ({
    page,
}) => {
    await openCalendar(page, { budget: 2, past14: true });
    const first = day(page, '2027-08-10');
    const tooEarly = day(page, '2027-08-31');
    const allowed = day(page, '2027-09-01');
    const calendarStatus = page.locator('#calendarStatus');

    await first.click();
    await tooEarly.click();
    await expect(calendarStatus).toBeHidden();
    await page.getByRole('button', { name: /Максимум отдыха/ }).click();
    await expect(calendarStatus).not.toContainText(/полных календарных дн\./);

    await tooEarly.click();
    await allowed.click();
    await expect(calendarStatus).toBeHidden();
    await page.getByRole('button', { name: /Максимум отдыха/ }).click();
    await expect(page.locator('#legalHint')).toContainText(
        'Автоматические даты не добавлены. Ручные даты сохранены.'
    );

    const budget = page.locator('#budget');
    await budget.fill('');
    await budget.blur();
    await expect(budget).toHaveValue('2');
    await budget.fill('1');
    await budget.blur();
    await expect(calendarStatus).toContainText('при бюджете 1');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(allowed).toHaveAttribute('aria-pressed', 'true');
    await expect(tooEarly).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#budgetText')).toHaveText('2 / 1');
});

test('applies the exact dates shown in a comparison and discards stale cards', async ({
    page,
}) => {
    await openCalendar(page, {
        budget: 10,
        past14: true,
        blockedRanges: [
            { from: '2027-01-01', to: '2027-08-01' },
            { from: '2027-08-07', to: '2027-09-05' },
            { from: '2027-09-11', to: '2027-12-31' },
        ],
    });
    const compare = page.getByRole('button', { name: 'Сравнить варианты' });
    await expect(compare).toBeVisible();
    await compare.click();
    const card = page.getByRole('article').filter({ hasText: 'Больше денег' });
    await expect(card).toContainText('10 из 10 отпускных дн.');
    await expect(card).toContainText('остаток 0');
    await expect(card).toContainText('Отпуск: 2 авг — 6 авг · 6 сен — 10 сен');
    await card.getByRole('button', { name: /Применить вариант/ }).click();
    await expect(page.locator('#budgetText')).toHaveText('10 / 10');
    expect(await selectedDates(page, 'auto')).toEqual([
        '2027-08-02',
        '2027-08-03',
        '2027-08-04',
        '2027-08-05',
        '2027-08-06',
        '2027-09-06',
        '2027-09-07',
        '2027-09-08',
        '2027-09-09',
        '2027-09-10',
    ]);

    const budget = page.locator('#budget');
    await budget.fill('5');
    await budget.blur();
    await expect(page.locator('#alternativePlans')).toHaveText(
        'Условия изменились. Сравните варианты заново.'
    );
    await expect(
        page.getByRole('button', { name: /Применить вариант/ })
    ).toHaveCount(0);
    await compare.click();
    await expect(card).toContainText('5 из 5 отпускных дн.');
});

test('keeps the compatible part of a saved plan across reloads', async ({
    page,
}) => {
    const october = [
        '2027-10-04',
        '2027-10-05',
        '2027-10-06',
        '2027-10-07',
        '2027-10-08',
    ];
    await openCalendar(page, {
        past14: true,
        manual: ['2027-08-10'],
        auto: [
            '2027-08-11',
            '2027-08-12',
            '2027-08-13',
            '2027-08-14',
            '2027-08-15',
            ...october,
        ],
    });
    await expect(page.locator('#legalHint')).toContainText(
        'Из сохранённого плана убрано 5 автодн.'
    );
    expect(await selectedDates(page, 'manual')).toEqual(['2027-08-10']);
    expect(await selectedDates(page, 'auto')).toEqual(october);

    await page.reload();
    await expect(page.locator('#budgetText')).toHaveText('6 / 28');
    await expect(page.locator('#legalHint')).not.toContainText(
        'Из сохранённого плана'
    );
    expect(await selectedDates(page, 'manual')).toEqual(['2027-08-10']);
    expect(await selectedDates(page, 'auto')).toEqual(october);
});

test('offers both actions on mobile and adds a range without official holidays', async ({
    page,
}) => {
    await page.setViewportSize({ width: 395, height: 844 });
    await openCalendar(page);
    const chooseDates = page.getByRole('link', { name: 'Выбрать даты' });
    await expect(chooseDates).toBeInViewport({ ratio: 1 });
    await expect(
        page.getByRole('link', { name: 'Подобрать отпуск' })
    ).toBeInViewport({ ratio: 1 });
    const horizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
    );
    expect(horizontalOverflow).toBe(false);

    await chooseDates.click();
    await expect(page).toHaveURL(/#vacationCalendar$/);
    await selectRange(page, '2027-04-30', '2027-05-04');
    await expect(page.locator('#rangeStatus')).toContainText(
        'Добавлено вручную: 4 дн.'
    );
    await expect(page.locator('#planSummaryText')).toHaveText(
        'Использовано 4 из 28 дн. · 5 дн. отдыха'
    );
    expect(await selectedDates(page, 'manual')).toEqual([
        '2027-04-30',
        '2027-05-02',
        '2027-05-03',
        '2027-05-04',
    ]);
    await expect(day(page, '2027-05-01')).toHaveAttribute(
        'aria-pressed',
        'false'
    );
});

test('keeps the starting daily rate for one vacation across two months', async ({
    page,
}) => {
    await openCalendar(page, {
        salary: 250000,
        oneoff: [{ id: 'january', month: 1, day: 15, amount: 300000 }],
    });
    await selectRange(page, '2027-01-29', '2027-02-05');
    await page.getByRole('link', { name: 'Доход', exact: true }).click();
    await expect(page.locator('#leaveNetNote')).toHaveText(
        /8 отпускных дн\. · отпускные 68\s259 ₽/
    );
});

test('opens the article comparison and preserves a personal plan after editing the example', async ({
    page,
}) => {
    const personalDates = ['2027-08-10'];
    await openCalendar(page, { salary: 185000, manual: personalDates });
    await page.getByRole('link', { name: 'Когда выгодно брать отпуск' }).click();
    await expect(page).toHaveURL(vacationArticle);
    const examples = [
        ['11–14 января', '15', '260 956 ₽', '39 044 ₽'],
        ['5–8 апреля', '22', '286 410 ₽', '13 590 ₽'],
        ['4–7 мая', '19', '277 798 ₽', '22 202 ₽'],
    ];
    const articleComparison = page.getByRole('table')
        .filter({ hasText: 'Доход за месяц до НДФЛ' });
    for (const [dates, workdays, income, loss] of examples) {
        const articleRow = articleComparison.getByRole('row').filter({ hasText: dates });
        await expect(articleRow.getByRole('cell')).toHaveText([
            dates, workdays, income, loss,
        ]);
    }
    await page.locator('a[href$="?example=compare-pay"]').click();

    const comparison = page.getByRole('table', { name: 'Начисления до НДФЛ' });
    for (const [dates, , income, loss] of examples) {
        const calculatorRow = comparison.getByRole('row').filter({ hasText: dates });
        await expect(calculatorRow.getByRole('cell')).toHaveText([
            dates, '40 956 ₽', income, `−${loss}`,
        ]);
    }

    await comparison.getByRole('link', { name: '5–8 апреля' }).click();
    const salary = page.locator('#salary');
    await expect(salary).toHaveValue('300000');
    expect(await selectedDates(page, 'manual')).toEqual([
        '2027-04-05', '2027-04-06', '2027-04-07', '2027-04-08',
    ]);
    await salary.fill('180000');
    await salary.blur();
    await expect(comparison.getByRole('row').filter({ hasText: 'Апрель' }))
        .toContainText(/171\s846 ₽\s+−8\s154 ₽/);

    await page.getByRole('link', { name: 'Перейти к своему плану' }).click();
    await expect(page).toHaveURL(vacationPage + '#vacationInputs');
    await expect(page.locator('#vacationExample')).toBeHidden();
    await expect(salary).toHaveValue('185000');
    expect(await selectedDates(page, 'manual')).toEqual(personalDates);
});

test('opens the article examples with their dates and visible rest periods', async ({
    page,
}) => {
    const examples = [
        ['january-pay', '11–14 января', '14 дн. отдыха с 1 января по 14 января за 4'],
        ['january-long', '11–15 января', '17 дн. отдыха с 1 января по 17 января за 5'],
        ['april-pay', '5–8 апреля', '6 дн. отдыха с 3 апреля по 8 апреля за 4'],
        ['may-holidays', '4–7 мая', '10 дн. отдыха с 1 мая по 10 мая за 4'],
        ['february-holidays', '24–26 февраля', '8 дн. отдыха с 21 февраля по 28 февраля за 3'],
        ['february-long', '8–21 февраля', '18 дн. отдыха с 6 февраля по 23 февраля за 14'],
        ['june-holidays', '15–18 июня', '9 дн. отдыха с 12 июня по 20 июня за 4'],
        ['november-holidays', '1–3 ноября', '9 дн. отдыха с 30 октября по 7 ноября за 3'],
    ];

    for (const [key, dates, rest] of examples) {
        await page.goto(vacationArticle);
        if (key === 'may-holidays') {
            await page.getByRole('link', { name: 'Открыть 4–7 мая в калькуляторе' }).click();
        } else {
            await page.locator(`a[href$="?example=${key}"]`).first().click();
        }
        await expect(page.locator('#exampleTitle')).toHaveText(`Отпуск ${dates}`);
        await expect(page.locator('#exampleRest')).toContainText(rest);
        await expect(page.locator('#periodList')).toHaveAttribute('open', '');
        if (key === 'may-holidays') {
            expect(await selectedDates(page, 'manual')).toEqual([
                '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07',
            ]);
        }
        if (key === 'january-long') {
            await expect(page.getByRole('table', { name: 'Начисления до НДФЛ' })
                .getByRole('row').filter({ hasText: 'Январь' }).getByRole('cell'))
                .toHaveText(['Январь', '51 195 ₽', '251 195 ₽', '−48 805 ₽']);
        }
    }
    await page.goto(vacationPage + '?example=may-full');
    await expect(page.locator('#exampleRest'))
        .toContainText('10 дн. отдыха с 1 мая по 10 мая за 6');
    await expect(day(page, '2027-05-08')).toHaveAttribute('aria-pressed', 'true');
    await expect(day(page, '2027-05-09')).toHaveAttribute('aria-pressed', 'false');
    await expect(day(page, '2027-05-10')).toHaveAttribute('aria-pressed', 'true');
});

test('opens the four-day summer example, calculates net income and keeps the personal plan', async ({
    page,
}) => {
    page.on('dialog', (dialog) => dialog.accept());
    const personalDates = ['2027-09-01'];
    await openCalendar(page, { salary: 185000, manual: personalDates });
    await page.getByRole('link', { name: 'Когда выгодно брать отпуск' }).click();
    const exampleLink = page.locator('a[href*="?week=friday&from=6&to=8"]');
    const exampleParagraph = page.locator('p').filter({ has: exampleLink });
    await expect(exampleParagraph).toContainText('13 дней отпуска');
    await expect(exampleParagraph).toContainText('40 326 ₽');
    await exampleLink.click();
    await expect(page).toHaveURL(vacationPage + '?week=friday&from=6&to=8#vacationFourDay');
    await expect(page.locator('#salary')).toHaveValue('300000');
    await expect(page.locator('#fourDayWeekdays input[value="friday"]')).toBeChecked();
    await expect(page.locator('#fourDayResult')).toContainText('Июнь–август. Отпускных дней по графику: 13.');
    await expect(page.locator('#fourDayResult')).toContainText(
        /По сравнению с текущим планом за период −41\s275 ₽, за год −40\s326 ₽/,
    );
    expect(await selectedDates(page, 'manual')).toEqual([]);
    expect(await selectedDates(page, 'auto')).toEqual([]);
    await page.getByRole('button', { name: 'Применить как ручные даты' }).click();
    await expect.poll(() => selectedDates(page, 'manual')).toEqual([
        '2027-06-04', '2027-06-11', '2027-06-18', '2027-06-25',
        '2027-07-02', '2027-07-09', '2027-07-16', '2027-07-23', '2027-07-30',
        '2027-08-06', '2027-08-13', '2027-08-20', '2027-08-27',
    ]);

    await page.locator('#fourDayWeekdays input[value="friday"]').uncheck();
    await page.locator('#fourDayWeekdays input[value="monday"]').check();
    await page.getByLabel('Последний месяц').selectOption('6');
    await page.getByRole('button', { name: 'Применить как ручные даты' }).click();
    await expect(page.locator('#fourDayResult')).toBeHidden();
    await expect.poll(() => selectedDates(page, 'manual')).toEqual([
        '2027-06-07', '2027-06-21', '2027-06-28',
        '2027-06-04', '2027-06-11', '2027-06-18', '2027-06-25',
        '2027-07-02', '2027-07-09', '2027-07-16', '2027-07-23', '2027-07-30',
        '2027-08-06', '2027-08-13', '2027-08-20', '2027-08-27',
    ].sort());
    await expect(day(page, '2027-06-14')).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('link', { name: 'Перейти к своему плану' }).click();
    await expect(page.locator('#salary')).toHaveValue('185000');
    expect(await selectedDates(page, 'manual')).toEqual(personalDates);
    expect(await selectedDates(page, 'auto')).toEqual([]);
});

test('applies any selected weekdays as manual dates without automatic-plan rules', async ({
    page,
}) => {
    const personalDates = ['2027-06-07', '2027-08-10'];
    await openCalendar(page, {
        budget: 3,
        past14: true,
        manual: personalDates,
        auto: ['2027-10-04'],
    });
    await expect(page.locator('#salary')).toHaveValue('300000');
    await page.getByText('Сокращённая рабочая неделя', { exact: true }).click();
    await page.locator('#fourDayWeekdays input[value="friday"]').uncheck();
    await page.locator('#fourDayWeekdays input[value="monday"]').check();
    await page.getByLabel('Последний месяц').selectOption('6');
    const result = page.locator('#fourDayResult');
    await expect(result).toContainText('автодаты будут сброшены.');
    await expect(result).toContainText('Текущий ручной план будет заменён');
    await expect(day(page, '2027-10-04')).toHaveAttribute('aria-pressed', 'true');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Применить как ручные даты' }).click();
    await expect.poll(() => selectedDates(page, 'manual')).toEqual([
        '2027-06-07', '2027-06-21', '2027-06-28',
    ]);
    expect(await selectedDates(page, 'auto')).toEqual([]);
    await expect(page.locator('#budgetText')).toHaveText('3 / 3');
    await expect(day(page, '2027-06-14')).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    expect(await selectedDates(page, 'manual')).toEqual([
        '2027-06-07', '2027-06-21', '2027-06-28',
    ]);
    expect(await selectedDates(page, 'auto')).toEqual([]);
    await day(page, '2027-06-07').click();
    await expect(day(page, '2027-06-07')).toHaveAttribute('aria-pressed', 'false');
    await expect(result).toBeHidden();
    expect(await selectedDates(page, 'manual')).toEqual([
        '2027-06-21', '2027-06-28',
    ]);
    expect(await selectedDates(page, 'auto')).toEqual([]);
});

test('applies as much of the selected weekday schedule as the budget allows', async ({
    page,
}) => {
    await openCalendar(page, {
        budget: 2,
        past14: true,
        manual: ['2027-01-11'],
        auto: ['2027-10-04'],
    });
    await page.getByText('Сокращённая рабочая неделя', { exact: true }).click();
    await page.locator('#fourDayWeekdays input[value="friday"]').uncheck();
    await page.locator('#fourDayWeekdays input[value="monday"]').check();
    await page.getByLabel('Первый месяц').selectOption('6');
    await page.getByLabel('Последний месяц').selectOption('6');
    const result = page.locator('#fourDayResult');
    await expect(result).toContainText('первые 2 дн. по графику');
    await expect(result).toContainText('Прежний ручной план будет заменён');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Применить как ручные даты' }).click();
    await expect.poll(() => selectedDates(page, 'manual')).toEqual([
        '2027-06-07', '2027-06-21',
    ]);
    await expect.poll(() => selectedDates(page, 'auto')).toEqual([]);
    await expect(page.locator('#toast')).toContainText('Применён частичный график: 2 дн.');
});

test('four-day income forecast matches the exact plan that will be applied', async ({
    page,
}) => {
    page.on('dialog', (dialog) => dialog.accept());
    await openCalendar(page, {
        salary: 300000,
        budget: 4,
        past14: true,
        manual: ['2027-08-10'],
    });
    await page.getByText('Сокращённая рабочая неделя', { exact: true }).click();
    await page.locator('#fourDayWeekdays input[value="friday"]').check();
    await page.locator('#fourDayFrom').selectOption('6');
    await page.locator('#fourDayTo').selectOption('6');

    const forecast = page.locator('#fourDayResult');
    await expect(forecast).toContainText('ручной план будет заменён');
    await expect(forecast).toContainText(/за год −10\s872 ₽/);
    const annualIncome = page.locator('#leaveNetYear');
    const previousIncome = await annualIncome.textContent();
    await page.getByRole('button', { name: 'Применить как ручные даты' }).click();
    await expect.poll(() => selectedDates(page, 'manual')).toEqual([
        '2027-06-04', '2027-06-11', '2027-06-18', '2027-06-25',
    ]);
    const appliedIncome = await annualIncome.textContent();
    const rubles = (text) => Number(text.replace(/[^\d]/g, ''));
    expect(rubles(appliedIncome) - rubles(previousIncome)).toBe(-10872);

    await page.locator('#fourDayTo').selectOption('7');
    await page.locator('#fourDayTo').selectOption('6');
    await expect(forecast).toContainText('за период 0 ₽, за год 0 ₽');
});

test('editing the short-week draft does not leave automatic dates over budget after cancel', async ({
    page,
}) => {
    await openCalendar(page, {
        budget: 5,
        past14: true,
        auto: ['2027-06-07', '2027-06-08', '2027-06-09', '2027-06-10'],
    });
    await page.getByText('Сокращённая рабочая неделя', { exact: true }).click();
    await page.locator('#fourDayWeekdays input[value="friday"]').uncheck();
    await page.locator('#fourDayWeekdays input[value="monday"]').check();

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Применить как ручные даты' }).click();
    await expect(page.locator('#budgetText')).toHaveText('4 / 5');

    const budget = page.locator('#budget');
    await budget.fill('3');
    await budget.blur();
    await expect.poll(() => selectedDates(page, 'auto')).toEqual([]);
    expect(await selectedDates(page, 'manual')).toEqual([]);

    await expect(page.locator('#budgetText')).toHaveText('0 / 3');
});

test('all presets find two paid parts inside the February holiday rest period', async ({
    page,
}) => {
    await openCalendar(page, {
        budget: 15,
        past14: false,
        minGap: 0,
        gapUnit: 'calendar',
        gapConfigured: true,
        minParts: 2,
        maxParts: 2,
        maxRestDays: 10,
        blockedRanges: [
            { from: '2027-01-01', to: '2027-02-07' },
            { from: '2027-02-25', to: '2027-12-31' },
        ],
    });
    for (const strategy of ['rest', 'money', 'balanced']) {
        await page.locator(`[data-preset="${strategy}"]`).click();
        await expect(page.locator('#budgetText')).toHaveText('15 / 15');
        expect(await selectedDates(page, 'auto')).toHaveLength(15);
        await expect(page.locator('#legalHint')).toContainText('14-дневная часть есть в плане.');
    }
});

test('shows a spinner while automatic dates are being calculated', async ({ page }) => {
    await openCalendar(page, { past14: true, minGap: 0, gapConfigured: true });
    const spinner = page.locator('#calculationStatus');

    const spinnerWasVisible = await page.evaluate(() => {
        document.querySelector('[data-preset="money"]').click();
        return !document.querySelector('#calculationStatus').hidden;
    });
    expect(spinnerWasVisible).toBe(true);
    await expect(page.locator('#vacationPresets')).toHaveAttribute('aria-busy', 'false');
    await expect(spinner).toBeHidden();
    await expect(page.locator('#budgetText')).not.toHaveText('0 / 28');
});

test('cleans weekend-only automatic parts from a saved plan', async ({ page }) => {
    await openCalendar(page, {
        budget: 3,
        past14: true,
        minGap: 0,
        gapConfigured: true,
        auto: ['2027-06-19', '2027-06-20', '2027-06-22'],
    });

    expect(await selectedDates(page, 'auto')).toEqual(['2027-06-22']);
    await expect(page.locator('#legalHint')).toContainText('убрано 2 автодн.');
});

test('finds two short leave parts connected by a Sunday without using it', async ({
    page,
}) => {
    await openCalendar(page, {
        budget: 8,
        past14: true,
        minPart: 2,
        minParts: 2,
        maxParts: 2,
        weekendPolicy: 'require',
        blockedRanges: [
            { from: '2027-01-01', to: '2027-08-05' },
            { from: '2027-08-15', to: '2027-12-31' },
        ],
    });
    const expected = [
        '2027-08-06', '2027-08-07', '2027-08-09', '2027-08-10',
        '2027-08-11', '2027-08-12', '2027-08-13', '2027-08-14',
    ];
    for (const strategy of ['money', 'balanced']) {
        await page.locator(`[data-preset="${strategy}"]`).click();
        await expect.poll(() => selectedDates(page, 'auto')).toEqual(expected);
    }
});

test('finds three short leave parts in one continuous rest period', async ({ page }) => {
    await openCalendar(page, {
        budget: 14,
        past14: true,
        minPart: 2,
        minParts: 3,
        maxParts: 3,
        maxRestDays: 17,
        weekendPolicy: 'require',
        blockedRanges: [
            { from: '2027-01-01', to: '2027-08-05' },
            { from: '2027-08-22', to: '2027-12-31' },
        ],
    });
    const expected = [
        '2027-08-06', '2027-08-07',
        '2027-08-09', '2027-08-10', '2027-08-11', '2027-08-12', '2027-08-13', '2027-08-14',
        '2027-08-16', '2027-08-17', '2027-08-18', '2027-08-19', '2027-08-20', '2027-08-21',
    ];
    for (const strategy of ['money', 'balanced']) {
        await page.locator(`[data-preset="${strategy}"]`).click();
        await expect.poll(() => selectedDates(page, 'auto')).toEqual(expected);
        await expect(page.locator('#planSummaryText')).toHaveText(
            'Использовано 14 из 14 дн. · 17 дн. отдыха',
        );
    }
});

test('loads the article illustrations on mobile and opens a personal calculation', async ({
    page,
}) => {
    await page.setViewportSize({ width: 395, height: 844 });
    await page.goto(vacationArticle);
    const article = page.getByRole('article');
    await expect(article.getByRole('heading', { level: 1 })).toHaveCount(1);
    for (const name of [/Снижение дохода до НДФЛ/, /Календарь с 1 по 10 мая/]) {
        const illustration = article.getByRole('img', { name });
        await illustration.scrollIntoViewIfNeeded();
        await expect.poll(() => illustration.evaluate((img) => img.naturalWidth))
            .toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(395);

    await article.getByRole('link', { name: 'Рассчитать свой отпуск на 2027 год' }).click();
    await expect(page).toHaveURL(vacationPage + '#vacationInputs');
    await expect(day(page, '2027-01-01')).toBeVisible();
    await expect(page.locator('#vacationExample')).toBeHidden();
    const salary = page.getByLabel('Оклад в месяц до НДФЛ');
    await salary.fill('120000');
    await salary.blur();
    await selectRange(page, '2027-05-04', '2027-05-07');
    await page.getByText('Доход по месяцам', { exact: true }).click();
    const may = page.getByRole('table', { name: 'Доход по месяцам' })
        .getByRole('row').filter({ has: page.getByRole('cell', { name: 'Май', exact: true }) });
    await expect(may.getByRole('cell')).toHaveText([
        'Май', '4 дн.', '94 737', '16 382', '0', '96 674',
    ]);
});

test('tries distinct automatic plans with the same conditions until they run out', async ({
    page,
}) => {
    await openCalendar(page, {
        budget: 2,
        minPart: 1,
        maxParts: 2,
        past14: true,
        manual: ['2027-02-15'],
        blockedMonths: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11],
        blockedRanges: [{ from: '2027-05-07', to: '2027-05-31' }],
    });
    await page.getByRole('button', { name: /Максимум отдыха/ }).click();
    await expect(day(page, '2027-05-04')).toHaveAttribute('aria-pressed', 'true');

    const next = page.getByRole('button', { name: 'Попробовать следующий вариант' });
    const notice = page.locator('#nextPlanStatus');
    const seen = ['2027-05-04'];
    for (const number of [2, 3]) {
        await next.click();
        await expect(notice).toHaveText(`Показан вариант № ${number}.`);
        await expect.poll(async () => {
            const dates = await selectedDates(page, 'auto');
            return dates.length === 1 && !seen.includes(dates[0]);
        }).toBe(true);
        seen.push(...await selectedDates(page, 'auto'));
    }
    expect(seen.sort()).toEqual(['2027-05-04', '2027-05-05', '2027-05-06']);
    const last = await selectedDates(page, 'auto');
    await next.click();
    await expect(next).toBeDisabled();
    await expect(notice).toContainText('Других вариантов');
    expect(await selectedDates(page, 'auto')).toEqual(last);
    expect(await selectedDates(page, 'manual')).toEqual(['2027-02-15']);
    await day(page, '2027-02-15').press('Enter');
    await expect(next).toBeHidden();
});

test('maximizes rest and minimizes weekends in the mandatory 14-day part', async ({
    page,
}) => {
    await openCalendar(page);
    const maximize = page.getByRole('button', { name: /Максимум отдыха/ });
    const summary = page.locator('#planSummaryText');
    const nonworkingLeave = page.locator('.selected-auto.off[data-date]');

    await page.getByRole('button', { name: /Больше летом/ }).click();
    await maximize.click();
    await expect(summary).toContainText('Использовано 28 из 28 дн.');
    await expect(page.locator('#activeRules')).toContainText('14-дневная часть есть в плане');
    expect(await nonworkingLeave.count()).toBeLessThanOrEqual(4);

    await page.getByRole('button', { name: 'Попробовать следующий вариант' }).click();
    await expect(page.locator('#nextPlanStatus')).toContainText('Показан вариант № 2');
    await expect(summary).toContainText('Использовано 28 из 28 дн.');
    expect(await nonworkingLeave.count()).toBeLessThanOrEqual(4);

    await page.locator('#past14').check();
    await page.getByRole('button', { name: /К праздникам/ }).click();
    await page.getByText('Больше настроек', { exact: true }).click();
    const minimum = page.getByLabel('Минимум дней в части', { exact: true });
    await minimum.fill('3');
    await minimum.blur();
    await maximize.click();
    await expect(summary).toHaveText('Использовано 28 из 28 дн. · 57 дн. отдыха');
    await expect(nonworkingLeave).toHaveCount(0);

    const dates = await selectedDates(page, 'auto');
    expect(dates.filter((date) => date.startsWith('2027-11-'))).toEqual([
        '2027-11-01', '2027-11-02', '2027-11-03',
    ]);
});

test('shows relevant planning fields and keeps one rule per month', async ({ page }) => {
    await openCalendar(page, { preferredMonths: [4], blockedMonths: [4] });
    await page.getByText('Больше настроек', { exact: true }).click();

    await expect(page.getByLabel('Минимум дней в части', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('Минимум дней между периодами отдыха')).toHaveValue('10');
    await expect(page.getByLabel('Какие дни считать')).toHaveValue('working');

    const parts = page.getByRole('group', { name: 'Количество частей отпуска' });
    await expect(parts.getByLabel('От', { exact: true })).toHaveValue('1');
    await expect(parts.getByLabel('До', { exact: true })).toHaveValue('6');
    await page.getByText('Рабочий год и выходные', { exact: true }).click();
    const minimum = page.getByLabel('Сколько выходных включить в часть');
    await expect(minimum).toBeHidden();
    const weekendRule = page.getByLabel('Дополнительное требование к части');
    await weekendRule.selectOption('custom');
    await expect(minimum).toBeVisible();
    await minimum.fill('2');
    await minimum.blur();
    await weekendRule.selectOption('any');
    await expect(minimum).toBeHidden();

    await page.getByText('Месяцы', { exact: true }).click();
    const may = page.getByLabel('Май', { exact: true });
    await expect(may).toHaveValue('blockedMonths');
    await may.selectOption('avoidedMonths');
    await expect(day(page, '2027-05-04')).not.toHaveClass(/\bblocked\b/);
    await expect.poll(() => page.evaluate((key) => {
        const { preferredMonths, avoidedMonths, blockedMonths } = JSON.parse(localStorage.getItem(key));
        return [preferredMonths, avoidedMonths, blockedMonths];
    }, storageKey)).toEqual([[], [4], []]);

    const clear = page.getByRole('button', { name: 'Снять все исключения дат и месяцев' });
    await expect(clear).toBeHidden();
    await may.selectOption('blockedMonths');
    await clear.click();
    await expect(may).toHaveValue('normal');
    await expect(clear).toBeHidden();
});

test('keeps expanded settings fields inside their content areas', async ({ page }) => {
    await openCalendar(page);
    const summary = page.getByText('Больше настроек', { exact: true });
    await summary.click();
    const settings = page.locator('details').filter({ has: summary });
    for (const title of ['Месяцы', 'Исключить конкретные даты', 'Рабочий год и выходные']) {
        await settings.getByText(title, { exact: true }).click();
    }
    await settings.locator('#weekendRule').selectOption('custom');

    for (const width of [320, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const overflowing = await settings.evaluate((section) => {
            return [...section.querySelectorAll('input, select')].filter((field) => {
                if (!field.getClientRects().length) return false;
                const rect = field.getBoundingClientRect();
                for (let parent = field.parentElement; parent !== section; parent = parent.parentElement) {
                    if (!parent.matches('.rule-controls, .block-date-grid, .more-settings-content, .inline-control')) continue;
                    const bounds = parent.getBoundingClientRect();
                    const style = getComputedStyle(parent);
                    const left = bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
                    const right = bounds.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
                    if (rect.left < left - 1 || rect.right > right + 1) return true;
                }
                return false;
            }).map((field) => field.id);
        });
        expect(overflowing, `Раскрытые настройки при ${width}px`).toEqual([]);
    }
});

test('prints the entire calendar and both leave markings on one A4 page', async ({ page }) => {
    await openCalendar(page, {
        past14: true,
        manual: ['2027-08-10'],
        auto: ['2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07', '2027-10-08'],
    });
    const title = page.getByRole('heading', { name: 'Календарь отдыха 2027' });
    await expect(title).toBeHidden();
    await expect(page.locator('#printRestPeriods')).toBeHidden();
    await page.emulateMedia({ media: 'print' });

    await expect(title).toBeVisible();
    await expect(title).toHaveCSS('color', 'rgb(24, 32, 44)');
    await expect(title).toHaveCSS('text-align', 'center');
    await expect(page.locator('#months .month h3').first()).toHaveCSS('color', 'rgb(24, 32, 44)');
    await expect(page.getByRole('link', { name: 'Telegram @frontend_lead_mentor' })).toBeVisible();
    await expect(page.locator('#months .month')).toHaveCount(12);
    await expect(page.locator('#months [data-date]')).toHaveCount(365);
    await expect(page.locator('#vacationIncome')).toBeHidden();
    await expect(page.locator('#printRestList li')).toHaveText([
        '10.08 · 1 дн.',
        '02.10–10.10 · 9 дн.',
    ]);
    await expect(day(page, '2027-08-10')).toHaveCSS('border-top-style', 'solid');
    await expect(day(page, '2027-10-04')).toHaveCSS('border-top-style', 'dashed');
    await expect(day(page, '2027-12-31')).toHaveCSS('text-decoration-line', 'underline');
    await expect(day(page, '2027-05-09')).toHaveClass(/\bholiday\b/);
    await expect(day(page, '2027-02-20')).toHaveCSS('text-decoration-line', 'none');

    const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1');
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(pdf).toMatch(/\/MediaBox\s*\[0 0 59[45](?:\.\d+)? 84[12](?:\.\d+)?\]/);
});
