import { test, expect } from '@playwright/test'
import { openMenu, SCREENS } from './helpers'

test.describe('Iron Snake mode', () => {
  test('enabling the toggle swaps the grid readout for a level goal', async ({ page }) => {
    await openMenu(page)

    const toggle = page.locator('#iron-snake-toggle')
    await toggle.check()
    await expect(toggle).toBeChecked()

    await page.locator('#new-game').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()

    // In Iron Snake mode the HUD hides the grid size and shows the goal instead.
    await expect(page.locator('#iron-snake-goal-display')).toBeVisible()
    await expect(page.locator('#grid-display')).toBeHidden()
    await expect(page.locator('#level')).toHaveText('1')

    // The readout reads like "12 pts"; the leading number is the level 1 goal,
    // which must be a positive number of points to collect.
    await expect(page.locator('#iron-snake-goal')).toHaveText(/^\d+ pts?$/)
    const goal = await page.locator('#iron-snake-goal').textContent()
    expect(parseInt(goal ?? '', 10)).toBeGreaterThan(0)
  })
})
