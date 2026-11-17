import { expect, test } from '../playwright/fixtures';
import { PLAYWRIGHT_BASE_URL } from '../playwright/config';
import type { Locator, Page, Response } from '@playwright/test';
import { createBareTimeEntryViaApi } from './utils/api';

// Untangle fork (phase 03.2, BRAND-01..04): browser proof of the appearance and branding phase.
// Pre-paint: resources/views/branding/early-theme.blade.php sets `light|dark` and `accent-<id>` on
// <html> from the server payload before any bundle runs. Accent presets: resources/css/
// untangle-theme.css (Untangle default) and resources/css/accent-presets.css. The organization icon
// is stored on the public disk; CI runs no storage:link, so the icon URL is fulfilled with test.png.

const ICON_FILE = './resources/testfiles/test.png';
const ICON_ROUTE = '**/storage/organization-icons/**';
const SWITCHER = '[data-testid="organization_switcher"]:visible';

// Preset triplets (light = step 400 / 500, dark = step 300) from the shipped stylesheets.
const UNTANGLE_LIGHT_400 = '0, 124, 107';
const UNTANGLE_DARK_300 = '0, 245, 212';
const UNTANGLE_LIGHT_BG = '#F9FCFD';
const VIOLET_DARK_300 = '222, 169, 254';
const EMBER_LIGHT_500 = '156, 69, 4';

/** Computed value of a custom property on <html>, trimmed. */
async function htmlVar(page: Page, name: string): Promise<string> {
    return page.evaluate(
        (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
        name
    );
}

/** Whitespace-free, lower-case form, so serialisation details never decide a comparison. */
function compact(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
}

function isAppearanceSave(
    response: Response,
    expected: { theme?: string; accent?: string }
): boolean {
    if (!response.url().endsWith('/user/appearance') || response.request().method() !== 'PUT') {
        return false;
    }
    let body: { theme?: unknown; accent?: unknown } | null = null;
    try {
        body = response.request().postDataJSON();
    } catch {
        return false;
    }
    return (
        response.status() === 200 &&
        (expected.theme === undefined || body?.theme === expected.theme) &&
        (expected.accent === undefined || body?.accent === expected.accent)
    );
}

async function openCommandPalette(page: Page) {
    await page.getByTestId('command_palette_button').click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
}

async function runPaletteCommand(page: Page, name: string) {
    await openCommandPalette(page);
    await page.locator('[role="dialog"] input').fill(name);
    // The command palette search is debounced
    await page.waitForTimeout(300);
    const option = page.getByRole('option', { name, exact: true });
    await option.scrollIntoViewIfNeeded();
    await option.click();
}

/** Screenshot of a canvas once two consecutive captures are equal (chart animation finished). */
async function settledScreenshot(target: Locator): Promise<Buffer> {
    let previous = await target.screenshot();
    for (let attempt = 0; attempt < 10; attempt++) {
        await target.page().waitForTimeout(500);
        const current = await target.screenshot();
        if (Buffer.compare(previous, current) === 0) {
            return current;
        }
        previous = current;
    }
    return previous;
}

async function goToOrganizationSettings(page: Page) {
    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
    await page.locator(SWITCHER).click();
    await page.getByRole('menuitem', { name: 'Organization Settings' }).click();
    await expect(page.getByText('Organization icon', { exact: true })).toBeVisible({
        timeout: 10000,
    });
}

function organizationForm(page: Page): Locator {
    return page.locator('form').filter({ hasText: 'Organization Name' });
}

/** Select test.png, Save, and wait for the icon upload to succeed. Optionally renames the org. */
async function uploadOrganizationIcon(page: Page, newName?: string) {
    if (newName !== undefined) {
        await page.getByLabel('Organization Name').fill(newName);
    }
    await page.locator('#organization_icon').setInputFiles(ICON_FILE);
    await expect(page.getByText('New icon selected. Save to apply it.')).toBeVisible();
    await Promise.all([
        page.waitForResponse(
            (response) =>
                /\/organizations\/[^/]+\/icon$/.test(response.url()) &&
                response.request().method() === 'POST' &&
                response.status() === 200
        ),
        organizationForm(page).getByRole('button', { name: 'Save' }).click(),
    ]);
}

async function fulfilIconsWithTestPng(page: Page) {
    await page.route(ICON_ROUTE, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', path: ICON_FILE })
    );
}

async function expectSwitcherImage(page: Page) {
    const image = page.locator(SWITCHER).getByTestId('organization_icon_image');
    await expect(image).toBeVisible({ timeout: 10000 });
    await expect(image).toHaveAttribute('src', /organization-icons\//);
    await expect
        .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
}

// =============================================
// BRAND-01: Untangle is the default look
// =============================================

test('Untangle is the default palette for a new user', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');

    const html = page.locator('html');
    await expect(html).toHaveClass(/(^|\s)light(\s|$)/);
    await expect(html).toHaveClass(/(^|\s)accent-untangle(\s|$)/);
    await expect
        .poll(async () => compact(await htmlVar(page, '--color-accent-400')))
        .toBe(compact(UNTANGLE_LIGHT_400));
    await expect
        .poll(async () => compact(await htmlVar(page, '--color-bg-primary')))
        .toBe(compact(UNTANGLE_LIGHT_BG));

    // Owner decision D-10: no Syne anywhere; Inter stays the only typeface, titles included.
    const fonts = await page.evaluate(() => ({
        body: getComputedStyle(document.body).fontFamily,
        headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(
            (element) => getComputedStyle(element).fontFamily
        ),
        faces: Array.from(document.fonts).map((face) => face.family),
    }));
    expect(fonts.body).toContain('Inter');
    for (const family of [fonts.body, ...fonts.headings, ...fonts.faces]) {
        expect(family.toLowerCase()).not.toContain('syne');
    }

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(html).toHaveClass(/(^|\s)accent-untangle(\s|$)/);
    await expect
        .poll(async () => compact(await htmlVar(page, '--color-accent-300')))
        .toBe(compact(UNTANGLE_DARK_300));
});

// =============================================
// BRAND-02: the saved look is applied before anything loads
// =============================================

test('saved theme and accent are applied before any script runs', async ({ page }) => {
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');

    const themeSelect = page
        .getByRole('heading', { name: 'Theme', exact: true })
        .locator('xpath=ancestor::*[descendant::form][1]')
        .getByRole('combobox');
    await themeSelect.click();
    await page.getByRole('option', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

    await Promise.all([
        page.waitForResponse((response) =>
            isAppearanceSave(response, { theme: 'dark', accent: 'violet' })
        ),
        page
            .getByRole('radiogroup', { name: 'Accent color' })
            .getByRole('radio', { name: 'Violet' })
            .click(),
    ]);

    // A new device: every JS bundle is blocked and localStorage is empty before any page script
    // runs (addInitScript runs before the inline head script), so only the server-fed pre-paint
    // script can set the classes. The OS asks for light, the saved theme is dark.
    const fresh = await page.context().newPage();
    await fresh.emulateMedia({ colorScheme: 'light' });
    let blockedScripts = 0;
    await fresh.route('**/build/assets/*.js', (route) => {
        blockedScripts++;
        return route.abort();
    });
    await fresh.addInitScript(() => {
        try {
            window.localStorage.clear();
        } catch {
            /* storage unavailable */
        }
    });

    await fresh.goto(PLAYWRIGHT_BASE_URL + '/dashboard');

    const html = fresh.locator('html');
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(html).toHaveClass(/(^|\s)accent-violet(\s|$)/);
    await expect(html).not.toHaveClass(/(^|\s)light(\s|$)/);
    await expect
        .poll(async () => compact(await htmlVar(fresh, '--color-accent-300')))
        .toBe(compact(VIOLET_DARK_300));
    expect(blockedScripts).toBeGreaterThan(0);

    await fresh.close();
});

// =============================================
// BRAND-02/03: accent switch recolours the app and persists
// =============================================

test('an accent switch recolours the dashboard chart and persists', async ({ page, ctx }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await createBareTimeEntryViaApi(ctx, 'Accent chart entry', '1h');

    await page.goto(PLAYWRIGHT_BASE_URL + '/dashboard');
    const canvas = page
        .locator('div:has(> .chart)')
        .filter({ hasText: 'This Week' })
        .locator('.chart canvas')
        .first();
    await expect(canvas).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const before = await settledScreenshot(canvas);

    await Promise.all([
        page.waitForResponse((response) => isAppearanceSave(response, { accent: 'ember' })),
        runPaletteCommand(page, 'Accent color: Ember'),
    ]);

    const html = page.locator('html');
    await expect(html).toHaveClass(/(^|\s)accent-ember(\s|$)/);
    await expect(html).not.toHaveClass(/(^|\s)accent-untangle(\s|$)/);
    await expect
        .poll(async () => compact(await htmlVar(page, '--m365-meeting-bg')))
        .toContain(compact(EMBER_LIGHT_500));

    await page.waitForTimeout(1500);
    const after = await settledScreenshot(canvas);
    expect(Buffer.compare(before, after)).not.toBe(0);

    await page.reload();
    await expect(html).toHaveClass(/(^|\s)accent-ember(\s|$)/);
    await expect
        .poll(async () => compact(await htmlVar(page, '--color-accent-500')))
        .toBe(compact(EMBER_LIGHT_500));
});

// =============================================
// BRAND-02/04: accessible accent picker
// =============================================

test('the accent picker selects, resets and fits a 320 px screen', async ({ page }) => {
    await page.goto(PLAYWRIGHT_BASE_URL + '/user/profile');

    const group = page.getByRole('radiogroup', { name: 'Accent color' });
    const untangle = group.getByRole('radio', { name: 'Untangle' });
    const azure = group.getByRole('radio', { name: 'Azure' });
    const reset = page.getByRole('button', { name: 'Reset to Untangle' });

    await expect(untangle).toHaveAttribute('aria-checked', 'true');
    await expect(reset).toHaveCount(0);

    await azure.click();
    await expect(azure).toHaveAttribute('aria-checked', 'true');
    await expect(untangle).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('html')).toHaveClass(/(^|\s)accent-azure(\s|$)/);
    await expect(reset).toBeVisible();

    await reset.click();
    await expect(untangle).toHaveAttribute('aria-checked', 'true');
    await expect(azure).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('html')).toHaveClass(/(^|\s)accent-untangle(\s|$)/);
    await expect(reset).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 800 });
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(6);
    for (const radio of await radios.all()) {
        await expect(radio).toBeVisible();
        const box = await radio.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
});

// =============================================
// Organization icon (UI-SPEC "Organization Icon")
// =============================================

test('owner uploads an organization icon and sees it in the switcher', async ({ page }) => {
    await fulfilIconsWithTestPng(page);
    await goToOrganizationSettings(page);
    await expect(page.getByRole('button', { name: 'Upload icon' })).toBeVisible();

    await uploadOrganizationIcon(page);
    await expectSwitcherImage(page);
    await expect(page.getByRole('button', { name: 'Replace icon' })).toBeVisible();

    await page.reload();
    await expectSwitcherImage(page);

    await page.getByRole('button', { name: 'Remove icon' }).click();
    await expect(page.getByText('Organization icon removed.')).toBeVisible();
    const switcher = page.locator(SWITCHER);
    await expect(switcher.getByTestId('organization_icon_image')).toHaveCount(0, {
        timeout: 10000,
    });
    await expect(switcher.getByTestId('organization_icon_letter')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload icon' })).toBeVisible();
});

test('a broken icon URL falls back to the letter tile', async ({ page }) => {
    await fulfilIconsWithTestPng(page);
    await goToOrganizationSettings(page);
    await uploadOrganizationIcon(page, 'Zephyr Icons');
    await expectSwitcherImage(page);

    await page.unroute(ICON_ROUTE);
    await page.route(ICON_ROUTE, (route) =>
        route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' })
    );
    await page.reload();

    const switcher = page.locator(SWITCHER);
    await expect(switcher).toContainText('Zephyr Icons');
    await expect(switcher.getByTestId('organization_icon_image')).toHaveCount(0, {
        timeout: 10000,
    });
    const letter = switcher.getByTestId('organization_icon_letter');
    await expect(letter).toBeVisible();
    await expect(letter).toHaveText('Z');
});

test('an employee sees the organization icon read-only', async ({ ctx, employee }) => {
    await employee.page.goto(PLAYWRIGHT_BASE_URL + '/organizations/' + ctx.orgId);

    await expect(
        employee.page.getByText('Only organization owners and admins can change the icon.')
    ).toBeVisible({ timeout: 10000 });
    await expect(employee.page.getByTestId('organization_icon_field')).toBeVisible();
    await expect(employee.page.getByRole('button', { name: 'Upload icon' })).toHaveCount(0);
    await expect(employee.page.getByRole('button', { name: 'Remove icon' })).toHaveCount(0);
    await expect(employee.page.locator('#organization_icon')).toHaveCount(0);
});
