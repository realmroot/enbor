import type { Page } from '@playwright/test'
import { expect, gotoAuthed, test } from './fixtures'

test('starts server-owned browser sign-in without exposing an OAuth token [spec: auth/e2e-sign-in]', async ({
  page,
}) => {
  const authorizationUrl = 'https://oidc.test/authorize?state=server-owned-attempt'
  let attemptBody: unknown
  await page.route('**/api/v1/auth/authorization-attempts', async (route) => {
    attemptBody = route.request().postDataJSON()
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ authorizationUrl }),
    })
  })
  await page.route('https://oidc.test/authorize*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Realmroot authorization</h1>' }),
  )

  await page.goto('/agents')
  await page.getByRole('button', { name: 'Continue with OIDC provider' }).click()

  await expect(page).toHaveURL(authorizationUrl)
  expect(attemptBody).toEqual({ returnTo: '/agents' })
  expect(
    await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })),
  ).toEqual({ local: [], session: [] })
})

// The browser dimension of the e2e crown: drives the real SPA + Worker + D1 + auth
// through Chromium. Reserved for hermetic console journeys (sign-in, routing, admin
// CRUD that only writes D1) per the skill — a handful, not one-per-feature.
test.describe('console (real browser)', () => {
  test('labels only the User Context sentinel as a personal workspace [spec: web-console/shell]', async ({ page }) => {
    await gotoWithBrowserSession(page, {
      sub: 'realmroot-user-context',
      email: 'user-context@example.com',
      name: 'User Context',
      organization: { id: 'user:realmroot-user-context', name: 'Personal workspace' },
    })

    await expect(page.getByText('Personal workspace', { exact: true }).first()).toBeVisible()
  })

  test('labels an unnamed Organization Context with its id [spec: web-console/shell]', async ({ page }) => {
    await gotoWithBrowserSession(page, {
      sub: 'realmroot-organization-user',
      email: 'organization-context@example.com',
      name: 'Organization Context',
      organization: { id: 'org_real_context_123', name: 'Organization org_real_context_123' },
    })

    await expect(page.getByText('Organization org_real_context_123', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Personal workspace', { exact: true })).toHaveCount(0)
  })

  test('opens the desktop user menu with the signed-in ID token profile [spec: web-console/shell] [spec: auth/session-current]', async ({
    page,
  }) => {
    await gotoWithBrowserSession(page, {
      sub: 'desktop-profile-user',
      email: 'desktop-profile@example.com',
      name: 'Desktop Profile',
      organization: { id: 'org_desktop_profile', name: 'Organization org_desktop_profile' },
    })

    await page.getByRole('button', { name: 'User menu' }).click()

    await expect(page.getByRole('menu')).toContainText('Desktop Profile')
    await expect(page.getByRole('menu')).toContainText('desktop-profile@example.com')
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible()
  })

  test('opens the 390px user menu with the signed-in ID token profile [spec: web-console/shell] [spec: auth/session-current]', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoWithBrowserSession(page, {
      sub: 'mobile-profile-user',
      email: 'mobile-profile@example.com',
      name: 'Mobile Profile',
      organization: { id: 'org_mobile_profile', name: 'Organization org_mobile_profile' },
    })

    await page.getByRole('button', { name: 'User menu' }).click()

    await expect(page.getByRole('menu')).toContainText('Mobile Profile')
    await expect(page.getByRole('menu')).toContainText('mobile-profile@example.com')
    await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible()
  })

  test('signs in and navigates the console shell [spec: web-console/shell] [spec: auth/e2e-sign-in]', async ({
    page,
    token,
  }) => {
    const apiRequests: import('@playwright/test').Request[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiRequests.push(request)
    })
    await gotoAuthed(page, token, '/agents')

    // The authenticated shell rendered through the server-owned browser session.
    await expect(page.getByText('Enbor').first()).toBeVisible()

    // Navigate to Environments through the primary nav — real client-side routing.
    await page.getByRole('link', { name: 'Environments' }).first().click()
    await expect(page).toHaveURL(/\/environments$/)
    await expect(page.getByRole('button', { name: 'Create environment' })).toBeVisible()

    const protectedRpcRequests = apiRequests.filter((request) => {
      const path = new URL(request.url()).pathname
      return path !== '/api/v1/configz' && path !== '/api/v1/auth/config'
    })
    expect(protectedRpcRequests.length).toBeGreaterThan(0)
    for (const request of protectedRpcRequests) {
      const headers = request.headers()
      expect(headers.authorization).toBeUndefined()
      expect(headers.dpop).toBeUndefined()
    }
    expect(
      apiRequests.some(
        (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/auth/sessions',
      ),
    ).toBe(false)
  })

  test('creates an environment through the UI and sees it listed [spec: web-console/resource-lists]', async ({
    page,
    token,
    runId,
  }) => {
    await gotoAuthed(page, token, '/environments')

    await page.getByRole('button', { name: 'Create environment' }).click()
    const name = `ui-env-${runId}`
    const nameField = page.getByRole('textbox', { name: 'Name', exact: true })
    await nameField.fill(name)
    await page.getByRole('button', { name: 'Save environment' }).click()

    // The form's mutation writes D1, the list query invalidates + refetches from the
    // real backend, and the new row appears — the full SPA→Worker→D1 round-trip.
    await expect(page.getByText(name)).toBeVisible()
  })
})

async function gotoWithBrowserSession(
  page: Page,
  profile: { sub: string; email: string; name: string; organization: { id: string; name: string } },
) {
  await page.route('**/api/v1/auth/sessions/current', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: profile.sub, email: profile.email, name: profile.name },
        organization: profile.organization,
        project: { id: 'project_oidc_context', name: 'OIDC Context Project' },
      }),
    }),
  )
  await page.route('**/api/v1/projects*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'project_oidc_context',
            name: 'OIDC Context Project',
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
          },
        ],
        pagination: { limit: 50, hasMore: false, nextCursor: null },
      }),
    }),
  )
  await page.goto('/agents')
}
