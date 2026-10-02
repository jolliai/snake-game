import { test, expect, type Page } from '@playwright/test'
import { openMenu, SCREENS } from './helpers'

// Colour Blind Mode swaps the default green-snake/red-apple palette — the exact
// pair lost under deuteranopia and protanopia — for a blue/orange one, and
// stamps shape glyphs on collectibles so they are identifiable without colour.
//
// Most of the change lands on the <canvas>, which the rest of this suite
// deliberately avoids asserting on. But "the checkbox is checked" would pass
// against a toggle wired to nothing, so these tests read pixels back off the
// canvas to prove the palette actually reached the renderer.

/**
 * Classify every pixel on the board and count the ones dominated by a given
 * channel. The default P1 snake is green (#22c55e / #4ade80); the colour-blind
 * P1 snake is blue (#56b4e9) and its food is orange (#e69f00). Nothing else on
 * screen is strongly chromatic — the board is near-black greys and the grid
 * lines are translucent white — so these counts are a reliable fingerprint of
 * which palette is live, without pinning exact hex values.
 */
async function countDominantPixels(page: Page): Promise<{ green: number; blue: number; orange: number }> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)

    let green = 0
    let blue = 0
    let orange = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      // Ignore near-greyscale pixels (board, grid, shadows, background).
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue
      if (g > r * 1.4 && g > b * 1.4) green++
      else if (b > r * 1.3 && b > g * 1.05) blue++
      else if (r > b * 1.5 && g > b * 1.2 && r > g) orange++
    }
    return { green, blue, orange }
  })
}

/** Start a single-player game and let it paint one frame. */
async function startGame(page: Page): Promise<void> {
  await page.locator('#new-game').click()
  await expect(page.locator(SCREENS.game)).toBeVisible()
  // The snake only starts moving on the first direction key, so the board is
  // static here; one animation frame is enough for the first paint.
  await page.waitForTimeout(300)
}

test.describe('Colour Blind Mode', () => {
  test('the toggle repaints the board in the colour-blind palette', async ({ page }) => {
    // Establish the baseline first: a green snake on the default palette. Without
    // this, "no green pixels" would pass on a build that renders nothing at all.
    await openMenu(page)
    await startGame(page)
    const normal = await countDominantPixels(page)
    expect(normal.green).toBeGreaterThan(100)

    // Same game, mode on.
    await openMenu(page)
    const toggle = page.locator('#color-blind-toggle')
    await toggle.check()
    await expect(toggle).toBeChecked()
    await startGame(page)
    const colorBlind = await countDominantPixels(page)

    // The green snake is gone (a small residue is antialiasing on tile edges).
    expect(colorBlind.green).toBeLessThan(20)
    // ...replaced by the blue snake and the orange food.
    expect(colorBlind.blue).toBeGreaterThan(100)
    expect(colorBlind.orange).toBeGreaterThan(20)
  })

  test('the mode exposes a shape key and restyles the HUD', async ({ page }) => {
    await openMenu(page)
    // The legend is for the glyphs stamped on collectibles, so it has no reason
    // to exist until the mode is on.
    await page.locator('#color-blind-toggle').check()
    await startGame(page)

    const legend = page.locator('#color-blind-legend')
    await expect(legend).toBeVisible()
    // Each glyph drawn on the board must be explained here, or it's a mystery
    // symbol. These are the same icons the controls line and HUD badge use.
    for (const glyph of ['◆', '★', '⏱', '✂']) {
      await expect(legend).toContainText(glyph)
    }

    // The DOM half of the palette must track the canvas, or the P1 score colour
    // would still claim the snake is green.
    await expect(page.locator('body')).toHaveClass(/color-blind/)
  })

  test('the default palette is untouched when the mode is off', async ({ page }) => {
    await openMenu(page)
    await startGame(page)

    await expect(page.locator('#color-blind-legend')).toBeHidden()
    await expect(page.locator('body')).not.toHaveClass(/color-blind/)
  })

  test('the Rainbow Snake surprise is suppressed, banner and all', async ({ page }) => {
    // The rainbow flag does more than colour the snake: it flashes a banner and
    // routes the score to a hidden leaderboard. Hiding only the colours would
    // announce a surprise a colour-blind player can never see, so the roll
    // itself must be suppressed. ?rainbow=1 forces the roll on.
    await page.goto('/?rainbow=1')
    await expect(page.locator(SCREENS.menu)).toBeVisible()

    // Prove the forced-on path works before asserting its absence.
    await page.locator('#new-game').click()
    await expect(page.locator('#rainbow-banner')).toBeVisible()

    await page.goto('/?rainbow=1')
    await expect(page.locator(SCREENS.menu)).toBeVisible()
    await page.locator('#color-blind-toggle').check()
    await startGame(page)

    await expect(page.locator('#rainbow-banner')).toBeHidden()
  })
})
