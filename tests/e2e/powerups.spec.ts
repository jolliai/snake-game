import { test, expect, type Page } from '@playwright/test'
import { SCREENS } from './helpers'

// Power-ups spawn at random (~1 in 5 foods) and sit on the canvas, so they can't
// be exercised reliably by chance. The `?powerup=<type>` URL override forces the
// chosen type to spawn one cell ahead of the head, so the first move collects it
// — letting us assert the DOM toast + HUD badge deterministically. `?powerup=off`
// disables spawns entirely.

/** Start a single-player game under a ?powerup override and take the first step. */
async function startAndStep(page: Page, powerup: string): Promise<void> {
  await page.goto(`/?powerup=${powerup}`)
  await expect(page.locator(SCREENS.menu)).toBeVisible()
  await page.locator('#new-game').click()
  await expect(page.locator(SCREENS.game)).toBeVisible()
  // The forced power-up sits directly to the right; the snake spawns facing
  // RIGHT, so ArrowRight starts the loop and collects it on the next tick.
  await page.keyboard.press('ArrowRight')
}

test.describe('Power-ups', () => {
  test('Double Points: collecting flashes the toast and shows the HUD countdown', async ({ page }) => {
    await startAndStep(page, 'double')

    const toast = page.locator('#powerup-toast')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('Double Points')

    // The timed effect drives a HUD badge that counts down each tick.
    const status = page.locator('#powerup-status')
    await expect(status).toBeVisible()
    await expect(status).toContainText('Double Points')

    // The toast auto-dismisses; the HUD badge persists while the effect runs.
    await expect(toast).toBeHidden({ timeout: 5000 })
  })

  test('Slow-Mo: collecting flashes the toast and shows the HUD countdown', async ({ page }) => {
    await startAndStep(page, 'slow')

    const toast = page.locator('#powerup-toast')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('Slow-Mo')

    await expect(page.locator('#powerup-status')).toContainText('Slow-Mo')
  })

  test('Shrink: collecting flashes the toast but leaves no HUD badge (instant effect)', async ({ page }) => {
    await startAndStep(page, 'shrink')

    const toast = page.locator('#powerup-toast')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('Shrink')

    // Shrink is instant, so no timed-effect badge appears.
    await expect(page.locator('#powerup-status')).toBeHidden()
  })

  test('a Chaser bot diverts onto a forced power-up on its own', async ({ page }) => {
    // The forced power-up spawns one cell ahead of the head. A bot demo
    // auto-starts its loop (no keypress), and Chaser's high power-up appetite
    // makes the immediate pickup dominate the marginal food-path difference, so
    // it steps onto the collectible on its first move — deterministically.
    await page.goto('/?powerup=double')
    await expect(page.locator(SCREENS.menu)).toBeVisible()

    await page.locator('#start-demo').click()
    await expect(page.locator('#demo-panel')).toBeVisible()
    await page.locator('#demo-bot-select').selectOption('chaser')
    await page.locator('#demo-launch').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()

    const toast = page.locator('#powerup-toast')
    await expect(toast).toBeVisible({ timeout: 5000 })
    await expect(toast).toContainText('Double Points')
    await expect(page.locator('#powerup-status')).toContainText('Double Points')
  })

  test('bot-vs-bot: a bot collects a power-up, shown per-snake (P1-prefixed)', async ({ page }) => {
    // Power-ups are enabled in bot-vs-bot too. The forced power-up spawns ahead
    // of P1, so a Chaser as bot 1 collects it on its first move; the toast/HUD
    // are prefixed P1 because effects are per-snake here.
    await page.goto('/?powerup=double')
    await expect(page.locator(SCREENS.menu)).toBeVisible()

    await page.locator('#bot-vs-bot').click()
    await expect(page.locator('#bvb-panel')).toBeVisible()
    await page.locator('#bvb-bot1-select').selectOption('chaser')
    await page.locator('#bvb-launch').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()

    // Assert on the persistent HUD badge (it holds for the whole effect) rather
    // than the ~1.4s pickup toast, which can flake under parallel load. The P1
    // prefix confirms the effect is tracked per-snake in bot-vs-bot.
    const status = page.locator('#powerup-status')
    await expect(status).toContainText('P1', { timeout: 5000 })
    await expect(status).toContainText('Double Points')
  })

  test('?powerup=off never spawns a power-up', async ({ page }) => {
    // A bare "nothing appears" assertion passes on a build that has no power-ups
    // at all, so first prove the feature exists: the forced spawn must work.
    await startAndStep(page, 'double')
    await expect(page.locator('#powerup-toast')).toBeVisible({ timeout: 5000 })

    // Now the same flow with spawns disabled — neither the toast nor the HUD
    // badge should ever appear.
    await page.goto('/?powerup=off')
    await expect(page.locator(SCREENS.menu)).toBeVisible()
    await page.locator('#new-game').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()

    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(1200)
    await expect(page.locator('#powerup-toast')).toBeHidden()
    await expect(page.locator('#powerup-status')).toBeHidden()
  })
})
