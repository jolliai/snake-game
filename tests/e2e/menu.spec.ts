import { test, expect } from '@playwright/test'
import { openMenu, SCREENS } from './helpers'

test.describe('Main menu', () => {
  test('renders the title and a fresh high score', async ({ page }) => {
    await openMenu(page)

    await expect(page.locator('.menu-title')).toHaveText('Snake Game')
    // localStorage is empty in a fresh browser context, so the high score is 0.
    await expect(page.locator('#high-score')).toHaveText('0')
    await expect(page.locator('#iron-snake-toggle')).not.toBeChecked()
    await expect(page.locator('#color-blind-toggle')).not.toBeChecked()
  })

  // Asserting the buttons are merely *visible* is not evidence they work: the
  // element ids are part of the contract, so they get built before the features
  // behind them and a dead button passes. These assertions require each control
  // to actually do its job.
  test('the bot panels expand, and opening one closes the other', async ({ page }) => {
    await openMenu(page)

    await page.locator('#start-demo').click()
    await expect(page.locator('#demo-panel')).toBeVisible()

    await page.locator('#bot-vs-bot').click()
    await expect(page.locator('#bvb-panel')).toBeVisible()
    await expect(page.locator('#demo-panel')).toBeHidden()
  })

  test('two player launches a game with both score readouts', async ({ page }) => {
    await openMenu(page)

    await page.locator('#two-player').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()
    await expect(page.locator(SCREENS.menu)).toBeHidden()
    // Two-snake modes swap the single score for a per-player pair.
    await expect(page.locator('#p1-score-display')).toBeVisible()
    await expect(page.locator('#p2-score-display')).toBeVisible()
  })

  test('opens the leaderboards screen and returns to the menu', async ({ page }) => {
    await openMenu(page)

    await page.locator('#open-leaderboards').click()
    await expect(page.locator(SCREENS.leaderboards)).toBeVisible()
    await expect(page.locator(SCREENS.menu)).toBeHidden()

    await page.locator('#leaderboards-back').click()
    await expect(page.locator(SCREENS.menu)).toBeVisible()
    await expect(page.locator(SCREENS.leaderboards)).toBeHidden()
  })
})
