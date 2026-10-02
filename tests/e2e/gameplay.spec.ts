import { test, expect } from '@playwright/test'
import { startSinglePlayer, beginMovement, SCREENS } from './helpers'

test.describe('Single-player gameplay', () => {
  test('starts a new game with the expected initial readouts', async ({ page }) => {
    await startSinglePlayer(page)

    await expect(page.locator('#score')).toHaveText('0')
    await expect(page.locator('#level')).toHaveText('1')
    await expect(page.locator('#grid-size')).toHaveText('10x10')
    // Classic mode shows the grid size, not the Iron Snake goal.
    await expect(page.locator('#grid-display')).toBeVisible()
    await expect(page.locator('#iron-snake-goal-display')).toBeHidden()
  })

  test('pause (P) toggles the pause overlay once the snake is moving', async ({ page }) => {
    await startSinglePlayer(page)
    // Pause only works after the game loop starts, i.e. after the first move.
    await beginMovement(page)

    await page.keyboard.press('p')
    await expect(page.locator(SCREENS.pause)).toBeVisible()

    await page.keyboard.press('p')
    await expect(page.locator(SCREENS.pause)).toBeHidden()
    await expect(page.locator(SCREENS.game)).toBeVisible()
  })

  test('reset (R) returns to a fresh, unstarted game', async ({ page }) => {
    await startSinglePlayer(page)
    await beginMovement(page)

    await page.keyboard.press('r')
    // Still on the game screen, back to the initial state.
    await expect(page.locator(SCREENS.game)).toBeVisible()
    await expect(page.locator('#score')).toHaveText('0')
    await expect(page.locator('#level')).toHaveText('1')

    // The readouts above are 0/1 on a fresh game too, so on their own they pass
    // whether or not the key did anything. The discriminating assertion is that
    // the loop actually stopped: the snake spawned mid-board facing RIGHT and was
    // already moving, so without a working reset it reaches the wall and dies
    // within about a second. A real reset leaves it unstarted and it never moves.
    await page.waitForTimeout(3000)
    await expect(page.locator('#death-banner')).toBeHidden()
    await expect(page.locator(SCREENS.gameOver)).toBeHidden()
    await expect(page.locator('#score')).toHaveText('0')
  })
})
