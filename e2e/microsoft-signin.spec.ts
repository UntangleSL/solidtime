import { expect, test } from '@playwright/test';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';

// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration must
// be fully off: no Microsoft button, and the regular email/password login stays usable.
test('login page shows no Microsoft button when the integration is not configured', async ({
    page,
}) => {
    await page.goto(PLAYWRIGHT_BASE_URL + '/login');

    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByTestId('microsoft-sign-in')).toHaveCount(0);
});
