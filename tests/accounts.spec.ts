import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { mockApi } from './support/mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('admin can sign in and create a viewer without retaining the password', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administrator' })).toBeVisible()
  const adminPassword = page.getByLabel('Administrator password', { exact: true })
  await adminPassword.fill('test-admin-password')
  await expect(adminPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show Administrator password' }).click()
  await expect(adminPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide Administrator password' }).click()
  await expect(adminPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Open admin' }).click()
  await expect(page.getByRole('heading', { name: 'Control the library' })).toBeVisible()
  await expect(page.getByLabel('Search viewer accounts')).toHaveCSS('padding-left', '44px')

  await page.getByLabel('TMDB ID').fill('1')
  await page.getByLabel('Display label').fill('Owned capture demonstration')
  await page.getByLabel('Direct media URL').fill('/test-media/capture-test.mp4')
  await page.getByRole('button', { name: 'Add authorised source' }).click()
  await expect(page.getByRole('heading', { name: 'Owned capture demonstration' })).toBeVisible()
  await expect(page.getByText(/Added Owned capture demonstration/)).toBeVisible()

  await page.getByLabel('Username').fill('new.viewer')
  await page.getByLabel('Display name').fill('New Viewer')
  const temporaryPassword = page.getByLabel('Temporary password', { exact: true })
  await temporaryPassword.fill('temporary-password-123')
  await page.getByRole('button', { name: 'Show Temporary password' }).click()
  await expect(temporaryPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide Temporary password' }).click()
  await expect(temporaryPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'new.viewer' })).toBeVisible()
  await expect(page.getByText(/Created new.viewer/)).toBeVisible()
  await expect(page.getByLabel('Temporary password', { exact: true })).toHaveValue('')

  await page.getByRole('button', { name: /Reset password/ }).click()
  await expect(page.getByRole('dialog', { name: 'Reset new.viewer' })).toBeVisible()
  const resetPassword = page.getByLabel('New temporary password', { exact: true })
  await resetPassword.fill('replacement-password-456')
  await page.getByRole('button', { name: 'Show New temporary password' }).click()
  await expect(resetPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide New temporary password' }).click()
  await expect(resetPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByText(/Reset new.viewer's password/)).toBeVisible()

  // Deleting needs the username typed in; cancelling keeps the account.
  await page.getByRole('button', { name: 'Delete account new.viewer' }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete new.viewer?' })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(deleteDialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'new.viewer' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete account new.viewer' }).click()
  const confirmDelete = deleteDialog.getByRole('button', { name: 'Delete account' })
  await expect(confirmDelete).toBeDisabled()
  await deleteDialog.getByLabel('Type new.viewer to confirm').fill('new.viewe')
  await expect(confirmDelete).toBeDisabled()
  await deleteDialog.getByLabel('Type new.viewer to confirm').fill('new.viewer')
  await confirmDelete.click()
  await expect(deleteDialog).toHaveCount(0)
  await expect(page.getByText(/Deleted new.viewer/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'new.viewer' })).toHaveCount(0)
})

test('home and administrator sign-in have no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  const homeResults = await new AxeBuilder({ page }).analyze()
  expect(homeResults.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administrator' })).toBeVisible()
  const adminResults = await new AxeBuilder({ page }).analyze()
  expect(adminResults.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
})

test('viewer login enforces the first-password-change flow', async ({ page }) => {
  let changed = false
  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const account = {
      id: 'first-login-id',
      username: 'first.viewer',
      displayName: 'First Viewer',
      active: true,
      mustChangePassword: !changed,
      expiresAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      lastLoginAt: null,
    }
    if (path === '/api/auth/session') {
      return route.fulfill({ status: 401, json: { error: { message: 'Sign in to continue.' } } })
    }
    if (path === '/api/auth/login') return route.fulfill({ json: { data: { account } } })
    if (path === '/api/auth/change-password') {
      changed = true
      return route.fulfill({ json: { data: { account: { ...account, mustChangePassword: false } } } })
    }
    return route.fulfill({ json: { data: {} } })
  })

  await page.goto('/login?next=%2Fmovies')
  await page.getByLabel('Username').fill('first.viewer')
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('temporary-password-123')
  await page.getByRole('button', { name: 'Show Password' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide Password' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
  const firstLoginPassword = page.getByLabel('Temporary password', { exact: true })
  await firstLoginPassword.fill('temporary-password-123')
  await page.getByRole('button', { name: 'Show Temporary password' }).click()
  await expect(firstLoginPassword).toHaveAttribute('type', 'text')
  await page.getByLabel('New password', { exact: true }).fill('new-secure-password-456')
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-secure-password-456')
  await page.getByRole('button', { name: 'Save password and continue' }).click()
  await expect(page).toHaveURL(/\/movies$/)
})
