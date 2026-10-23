import { expect, test } from '@playwright/test';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import { test as loggedInTest, expect as loggedInExpect } from '../playwright/fixtures';

// The CI Playwright environment sets no SOLIDTIME_MICROSOFT_* variables, so the integration must
// be fully off: no Microsoft button, and the regular email/password login stays usable.
test('login page shows no Microsoft button when the integration is not configured', async ({
    page,
}) => {
    await page.goto(PLAYWRIGHT_BASE_URL + '/login');

    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByTestId('microsoft-sign-in')).toHaveCount(0);
});

// Same off-switch for the profile page: with the integration unconfigured there is no Microsoft
// section and the existing profile sections (here: Delete Account) are untouched.
loggedInTest.describe('profile page', () => {
    loggedInTest(
        'shows no Microsoft 365 section when the integration is not configured',
        async ({ page }) => {
            await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');

            await loggedInExpect(
                page.getByRole('button', { name: 'Delete Account' })
            ).toBeVisible();
            await loggedInExpect(page.getByTestId('microsoft-connection')).toHaveCount(0);
        }
    );
});
