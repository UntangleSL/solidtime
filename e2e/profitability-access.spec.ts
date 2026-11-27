import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test } from '../playwright/fixtures';
import type { TestContext } from '../playwright/fixtures';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
    createClientViaApi,
    createProjectMemberViaApi,
    createPublicProjectViaApi,
    getMembersViaApi,
} from './utils/api';

// Fork browser proofs of Phase 8 (project hour budgets and profitability): who sees the module (D-16)
// and money redaction (D-11). An employee without an assignment sees no Profitability item and gets a
// 404; once the Owner makes them project manager in Settings they see the hours of that project and
// never money (no amount, cost or margin header, tile or currency symbol).

const HOUR = 3600;

function firstOfMonth(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Saves contract terms through the fork's web route with the page's session (the route lives in the web
 * group, never under api/, so it needs the session cookie and the XSRF token, not the API token).
 */
async function putMonthlyTerms(page: Page, ctx: TestContext, projectId: string) {
    const cookies = await page.context().cookies(PLAYWRIGHT_BASE_URL);
    const xsrf = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN');
    const response = await page.request.put(
        `${PLAYWRIGHT_BASE_URL}/profitability/organizations/${ctx.orgId}/projects/${projectId}/contract`,
        {
            headers: {
                'X-XSRF-TOKEN': xsrf ? decodeURIComponent(xsrf.value) : '',
                Accept: 'application/json',
            },
            data: {
                service: 'SEO retainer',
                schedule: 'monthly',
                starts_on: firstOfMonth(),
                ends_on: null,
                budget_seconds: 40 * HOUR,
                amount_cents: 300000,
            },
        }
    );
    expect(response.status()).toBe(204);
}

test('an unassigned employee sees no Profitability item and gets 404', async ({ employee }) => {
    await employee.page.goto(`${PLAYWRIGHT_BASE_URL}/dashboard`);
    await expect(employee.page.getByTestId('dashboard_view')).toBeVisible();
    await expect(employee.page.getByRole('link', { name: 'Time' }).first()).toBeVisible();
    await expect(employee.page.getByRole('link', { name: 'Profitability' })).toHaveCount(0);

    const response = await employee.page.goto(`${PLAYWRIGHT_BASE_URL}/profitability`);
    expect(response?.status()).toBe(404);
    await expect(employee.page.getByTestId('profitability-page')).toHaveCount(0);
});

test('an employee made project manager sees hours but no money', async ({
    page,
    ctx,
    employee,
}) => {
    // Arrange: a billable project under contract, the employee is a member of it
    const client = await createClientViaApi(ctx, { name: 'Managed client' });
    const project = await createPublicProjectViaApi(ctx, {
        name: 'Managed project',
        is_billable: true,
        client_id: client.id,
    });
    await createProjectMemberViaApi(ctx, project.id, { member_id: employee.memberId });
    await putMonthlyTerms(page, ctx, project.id);
    const members = await getMembersViaApi(ctx);
    const employeeName = members.find((member) => member.id === employee.memberId)?.name;
    expect(employeeName).toBeTruthy();

    // The Owner assigns the employee as project manager in Settings
    await page.goto(`${PLAYWRIGHT_BASE_URL}/profitability`);
    await page.getByTestId('profitability-tab-settings').click();
    const row = page
        .getByTestId('profitability-managers-project')
        .locator(`[data-row-key="project:${project.id}"]`);
    await expect(row).toContainText('Managed project');
    await row.getByRole('button', { name: 'Add project manager' }).click();
    await Promise.all([
        page.waitForResponse(
            (response) =>
                response.url().includes(`/projects/${project.id}/managers`) &&
                response.request().method() === 'POST' &&
                response.status() === 204
        ),
        page
            .getByTestId('profitability-manager-option')
            .filter({ hasText: employeeName as string })
            .click(),
    ]);
    await expect(row.getByTestId('profitability-manager-chip')).toContainText(
        employeeName as string
    );

    // The employee now sees the item, the Projects tab only, and no money
    const employeePage = employee.page;
    await employeePage.goto(`${PLAYWRIGHT_BASE_URL}/dashboard`);
    await expect(employeePage.getByTestId('dashboard_view')).toBeVisible();
    await employeePage.getByRole('link', { name: 'Profitability' }).first().click();
    await employeePage.waitForURL(/\/profitability/);
    await expect(employeePage.getByTestId('profitability-page')).toBeVisible();
    await expect(employeePage.getByTestId('profitability-tab-projects')).toBeVisible();
    for (const tab of ['clients', 'people', 'settings']) {
        await expect(employeePage.getByTestId(`profitability-tab-${tab}`)).toHaveCount(0);
    }

    const table = employeePage.getByTestId('profitability-projects-table');
    await expect(table).toContainText('Managed project');
    await expect(table).toContainText('40 h');
    for (const money of ['Amount', 'Cost', 'Margin']) {
        await expect(table).not.toContainText(money);
    }
    await expect(table).not.toContainText(/[€$£]/);
    await expect(employeePage.getByTestId('profitability-money-kpis')).toHaveCount(0);

    // The project card shows the hours sold and no money tile
    await employeePage.goto(`${PLAYWRIGHT_BASE_URL}/projects/${project.id}`);
    const card = employeePage.getByTestId('profitability-summary-card');
    await expect(card.getByTestId('profitability-summary-sold')).toHaveText('40 h');
    await expect(card).toContainText('Hours sold');
    await expect(card).not.toContainText('Amount sold');
    await expect(card.getByTestId('profitability-summary-money')).toHaveCount(0);
    await expect(card).not.toContainText(/[€$£]/);
});
