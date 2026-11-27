import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import type { TestContext } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createClientViaApi, createPublicProjectViaApi, createTimeEntryViaApi } from './utils/api';

// Fork browser proofs of Phase 8 (project hour budgets and profitability): the Owner sets contract
// terms from the project card, plans an uneven quarter, and finds the project in the Profitability
// Projects tab. Dates are computed in UTC like the API helpers (test users run in UTC); the server
// works in Europe/Madrid, which only differs around midnight at a month boundary.

const HOUR = 3600;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** The first day of the current month, YYYY-MM-DD. */
function firstOfMonth(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-01`;
}

/** The first day of the current calendar quarter, YYYY-MM-DD. */
function firstOfQuarter(): string {
    const now = new Date();
    const month = Math.floor(now.getUTCMonth() / 3) * 3;
    return `${now.getUTCFullYear()}-${pad(month + 1)}-01`;
}

/** A billable project of a fresh client, public so every member of the organization sees it. */
async function billableProject(ctx: TestContext, name: string) {
    const client = await createClientViaApi(ctx, { name: `${name} client` });
    return createPublicProjectViaApi(ctx, { name, is_billable: true, client_id: client.id });
}

/**
 * Saves contract terms through the fork's web route with the page's session (the route lives in the web
 * group, never under api/, so it needs the session cookie and the XSRF token, not the API token).
 */
async function putContractTerms(
    page: Page,
    ctx: TestContext,
    projectId: string,
    terms: { schedule: string; starts_on: string; budget_seconds: number; amount_cents: number }
) {
    const cookies = await page.context().cookies(PLAYWRIGHT_BASE_URL);
    const xsrf = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
    const response = await page.request.put(
        `${PLAYWRIGHT_BASE_URL}/profitability/organizations/${ctx.orgId}/projects/${projectId}/contract`,
        {
            headers: {
                'X-XSRF-TOKEN': xsrf ? decodeURIComponent(xsrf.value) : '',
                Accept: 'application/json',
            },
            data: { service: 'SEO retainer', ends_on: null, ...terms },
        }
    );
    expect(response.status()).toBe(204);
}

test('owner sets monthly contract terms from the project card and sees hours sold and consumed', async ({
    page,
    ctx,
}) => {
    const project = await billableProject(ctx, 'Profitability monthly');
    await createTimeEntryViaApi(ctx, {
        description: 'Contract work',
        duration: '1h',
        projectId: project.id,
        billable: true,
    });

    await page.goto(`${PLAYWRIGHT_BASE_URL}/projects/${project.id}`);
    const card = page.getByTestId('profitability-summary-card');
    await expect(card.getByTestId('profitability-summary-empty')).toContainText(
        'No contract terms yet'
    );

    await card.getByRole('button', { name: 'Set contract terms' }).click();
    const editor = page.getByTestId('profitability-contract-editor');
    await expect(editor).toBeVisible();

    // Renews monthly from the first day of this month (the editor's default start date)
    await editor.getByTestId('contract-schedule').click();
    await page.getByRole('option', { name: 'Renews monthly' }).click();
    await expect(editor.getByTestId('contract-schedule')).toContainText('Renews monthly');
    await editor.locator('#contract-hours').fill('40');
    await editor.locator('#contract-hours').press('Tab');
    await editor.locator('#contract-amount').fill('3000');
    await editor.locator('#contract-amount').press('Tab');

    const [response] = await Promise.all([
        page.waitForResponse(
            (response) =>
                response.url().includes(`/projects/${project.id}/contract`) &&
                response.request().method() === 'PUT'
        ),
        page.getByTestId('contract-save').click(),
    ]);
    expect(response.status()).toBe(204);
    const body = response.request().postDataJSON();
    expect(body.schedule).toBe('monthly');
    expect(body.starts_on).toBe(firstOfMonth());
    expect(body.budget_seconds).toBe(40 * HOUR);
    expect(body.amount_cents).toBe(300000);

    await expect(card.getByTestId('profitability-summary-sold')).toHaveText('40 h');
    await expect(card.getByTestId('profitability-summary-consumed')).toHaveText('1 h');
});

test('owner plans an uneven quarter and saves only when the months add up', async ({
    page,
    ctx,
}) => {
    const project = await billableProject(ctx, 'Profitability quarterly');
    await putContractTerms(page, ctx, project.id, {
        schedule: 'quarterly',
        starts_on: firstOfQuarter(),
        budget_seconds: 120 * HOUR,
        amount_cents: 900000,
    });

    await page.goto(`${PLAYWRIGHT_BASE_URL}/projects/${project.id}`);
    const card = page.getByTestId('profitability-summary-card');
    await expect(card.getByTestId('profitability-summary-sold')).toHaveText('120 h');

    await card.getByRole('button', { name: 'Plan months' }).click();
    const grid = page.getByTestId('profitability-plan-grid');
    await expect(grid.getByTestId('plan-grid-row')).toHaveCount(3);
    const save = page.getByTestId('plan-save');

    // 110 h planned: the footer names the 10 h left and Save plan stays disabled
    for (const [index, hours] of [
        [0, '60'],
        [1, '40'],
        [2, '10'],
    ] as const) {
        await grid.getByTestId(`plan-input-${index}`).fill(hours);
        await grid.getByTestId(`plan-input-${index}`).press('Tab');
    }
    await expect(grid.getByTestId('plan-grid-sum')).toContainText('10 h left to distribute');
    await expect(save).toBeDisabled();

    // 60 / 40 / 20 add up to the 120 h sold
    await grid.getByTestId('plan-input-2').fill('20');
    await grid.getByTestId('plan-input-2').press('Tab');
    await expect(grid.getByTestId('plan-grid-sum')).toContainText('Planned 120 h of 120 h');
    await expect(save).toBeEnabled();

    const [response] = await Promise.all([
        page.waitForResponse(
            (response) => response.url().includes('/plan') && response.request().method() === 'PUT'
        ),
        save.click(),
    ]);
    expect(response.status()).toBe(204);

    const rows = card.getByTestId('profitability-month-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('td').first()).toHaveText('60 h');
    await expect(rows.nth(1).locator('td').first()).toHaveText('40 h');
    await expect(rows.nth(2).locator('td').first()).toHaveText('20 h');
});

test('the project appears in the Profitability projects tab with its status', async ({
    page,
    ctx,
}) => {
    const project = await billableProject(ctx, 'Profitability listed');
    await putContractTerms(page, ctx, project.id, {
        schedule: 'monthly',
        starts_on: firstOfMonth(),
        budget_seconds: 40 * HOUR,
        amount_cents: 300000,
    });
    await createTimeEntryViaApi(ctx, {
        description: 'Listed work',
        duration: '1h',
        projectId: project.id,
        billable: true,
    });

    await page.goto(`${PLAYWRIGHT_BASE_URL}/dashboard`);
    await page.getByRole('link', { name: 'Profitability' }).first().click();
    await page.waitForURL(/\/profitability/);
    await expect(page.getByTestId('profitability-page')).toBeVisible();

    const view = page.getByTestId('profitability-projects-view');
    const row = view.locator(
        `[data-testid="profitability-projects-row"][data-project-id="${project.id}"]`
    );
    await expect(row).toContainText('Profitability listed');
    await expect(row.getByTestId('profitability-status')).toBeVisible();
});
