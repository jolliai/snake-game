import { test, expect, type Page } from '@playwright/test'
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

// The hidden Rainbow Snake leaderboard (JOE-7): scores made during a rainbow
// game route to their own board, which stays secret until it holds an entry.
// `?rainbow=1|0` forces the roll so the routing is deterministic.

const RAINBOW_TAB = '.lb-tab[data-mode="rainbow"]'
const SINGLE_TAB = '.lb-tab[data-mode="single"]'

/**
 * Play one single-player run to the game-over screen. The snake spawns facing
 * RIGHT, so holding ArrowRight drives it into the wall for a fatal collision;
 * Space then dismisses the death freeze and finalizes the game.
 */
async function playSingleRunToGameOver(page: Page, rainbow: '1' | '0'): Promise<void> {
  await page.goto(`/?rainbow=${rainbow}`)
  await expect(page.locator(SCREENS.menu)).toBeVisible()
  await page.locator('#new-game').click()
  await expect(page.locator(SCREENS.game)).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#death-banner')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Space')
  await expect(page.locator(SCREENS.gameOver)).toBeVisible()
}

/** Enter a name into the game-over leaderboard prompt and save it. */
async function saveLeaderboardEntry(page: Page, name: string): Promise<void> {
  await expect(page.locator('#leaderboard-prompt')).toBeVisible()
  await page.locator('#leaderboard-name-input').fill(name)
  await page.locator('#leaderboard-name-form button[type="submit"]').click()
  await expect(page.locator('#leaderboard-confirmation')).toBeVisible()
}

test.describe('Rainbow Snake hidden leaderboard', () => {
  test('the Rainbow board tab stays hidden until a rainbow score exists', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator(SCREENS.menu)).toBeVisible()

    await page.locator('#open-leaderboards').click()
    await expect(page.locator(SCREENS.leaderboards)).toBeVisible()

    // Fresh context: no rainbow score yet, so the secret tab is not present.
    await expect(page.locator(RAINBOW_TAB)).toBeHidden()
    await expect(page.locator(SINGLE_TAB)).toBeVisible()
  })

  test('a rainbow game routes its score to the secret board and reveals the tab', async ({ page }) => {
    await playSingleRunToGameOver(page, '1')
    await saveLeaderboardEntry(page, 'RBWINNER')

    // Right after a rainbow run, View Leaderboard opens the newly-revealed board.
    await page.locator('#view-leaderboard').click()
    await expect(page.locator(SCREENS.leaderboards)).toBeVisible()

    const rainbowTab = page.locator(RAINBOW_TAB)
    await expect(rainbowTab).toBeVisible()
    await expect(rainbowTab).toHaveClass(/active/)
    await expect(page.locator('#leaderboard-table-wrap')).toContainText('RBWINNER')

    // The score must NOT leak onto the normal Single Player board.
    await page.locator(SINGLE_TAB).click()
    await expect(page.locator('#leaderboard-table-wrap')).not.toContainText('RBWINNER')
    await expect(page.locator('#leaderboard-table-wrap')).toContainText('No entries yet')
  })

  test('a normal game records to the standard board and keeps Rainbow hidden', async ({ page }) => {
    await playSingleRunToGameOver(page, '0')
    await saveLeaderboardEntry(page, 'PLAINRUN')

    await page.locator('#view-leaderboard').click()
    await expect(page.locator(SCREENS.leaderboards)).toBeVisible()

    // A non-rainbow score lands on Single Player and never reveals the secret tab.
    await expect(page.locator(RAINBOW_TAB)).toBeHidden()
    await expect(page.locator('#leaderboard-table-wrap')).toContainText('PLAINRUN')
  })
})
