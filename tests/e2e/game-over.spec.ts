import { test, expect } from '@playwright/test'
import { startSinglePlayer, beginMovement, SCREENS } from './helpers'

test.describe('Death and game over', () => {
  test('driving into the wall freezes on a death banner, then a key shows game over', async ({ page }) => {
    await startSinglePlayer(page)

    // The snake spawns mid-board facing RIGHT. Holding that course sends it into
    // the right wall within a few 200ms ticks; out-of-bounds is a fatal
    // collision (no wrap-around), which triggers the death freeze.
    await beginMovement(page, 'ArrowRight')

    // On death the board freezes and a banner appears until the player
    // acknowledges it. Allow generous time for the snake to traverse to the wall.
    await expect(page.locator('#death-banner')).toBeVisible({ timeout: 10_000 })
    // We're frozen on the game screen, not yet on the game-over screen.
    await expect(page.locator(SCREENS.gameOver)).toBeHidden()

    // Any non-camera key dismisses the freeze and finalizes the game.
    await page.keyboard.press('Space')

    await expect(page.locator(SCREENS.gameOver)).toBeVisible()
    await expect(page.locator(SCREENS.game)).toBeHidden()
    await expect(page.locator('#game-over-title')).toBeVisible()
    await expect(page.locator('#final-score')).toBeVisible()
  })

  test('play again from the game-over screen starts a fresh game', async ({ page }) => {
    await startSinglePlayer(page)
    await beginMovement(page, 'ArrowRight')
    await expect(page.locator('#death-banner')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Space')
    await expect(page.locator(SCREENS.gameOver)).toBeVisible()

    await page.locator('#play-again').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()
    await expect(page.locator('#score')).toHaveText('0')
    await expect(page.locator('#level')).toHaveText('1')
  })
})
