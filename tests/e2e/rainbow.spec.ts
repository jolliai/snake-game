import { test, expect } from '@playwright/test'
import { SCREENS } from './helpers'

// The Rainbow Snake surprise (JOE-7) fires on ~1 in 100 games, so it can't be
// exercised by chance. The `?rainbow=1|0` URL override forces the roll, letting
// us assert the DOM banner deterministically (the rainbow-coloured snake itself
// is on the canvas and not asserted here).

test.describe('Rainbow Snake surprise', () => {
  test('?rainbow=1 flashes the "Rainbow Snake" friendship banner, then auto-dismisses', async ({ page }) => {
    await page.goto('/?rainbow=1')
    await expect(page.locator(SCREENS.menu)).toBeVisible()

    await page.locator('#new-game').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()

    const banner = page.locator('#rainbow-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Rainbow Snake')

    // Holds for ~3s then fades out (banner + fade windows); .hidden sets display:none.
    await expect(banner).toBeHidden({ timeout: 5000 })
  })

  test('?rainbow=0 never shows the banner', async ({ page }) => {
    await page.goto('/?rainbow=0')
    await expect(page.locator(SCREENS.menu)).toBeVisible()

    await page.locator('#new-game').click()
    await expect(page.locator(SCREENS.game)).toBeVisible()

    // Give the game a beat to draw; the banner must stay hidden on a normal game.
    await page.waitForTimeout(300)
    await expect(page.locator('#rainbow-banner')).toBeHidden()
  })
})
