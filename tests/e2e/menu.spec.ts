import { test, expect } from '@playwright/test'
import { openMenu, SCREENS } from './helpers'

test.describe('Main menu', () => {
  test('renders the title, a fresh high score, and the core buttons', async ({ page }) => {
    await openMenu(page)

    await expect(page.locator('.menu-title')).toHaveText('Snake Game')
    // localStorage is empty in a fresh browser context, so the high score is 0.
    await expect(page.locator('#high-score')).toHaveText('0')

    await expect(page.locator('#new-game')).toBeVisible()
    await expect(page.locator('#two-player')).toBeVisible()
    await expect(page.locator('#start-demo')).toBeVisible()
    await expect(page.locator('#bot-vs-bot')).toBeVisible()
    await expect(page.locator('#iron-snake-toggle')).not.toBeChecked()
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
