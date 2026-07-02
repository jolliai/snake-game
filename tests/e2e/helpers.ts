import { expect, type Page } from '@playwright/test'

// The game renders on a <canvas>, so tests drive it via keyboard and assert on
// the surrounding DOM: screen visibility (the `.hidden` class sets
// `display: none`) and the score/level/goal readouts. These helpers wrap the
// handful of flows every spec repeats.

/** IDs of the top-level `.screen` containers, toggled via the `hidden` class. */
export const SCREENS = {
  menu: '#menu',
  game: '#game',
  gameOver: '#game-over',
  leaderboards: '#leaderboards',
  pause: '#pause',
} as const

/** Load the app and wait for the main menu to be visible. */
export async function openMenu(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator(SCREENS.menu)).toBeVisible()
}

/**
 * Start a single-player game from a freshly loaded menu and confirm we land on
 * the game screen. The snake does not move until the first directional key.
 */
export async function startSinglePlayer(page: Page): Promise<void> {
  await openMenu(page)
  await page.locator('#new-game').click()
  await expect(page.locator(SCREENS.game)).toBeVisible()
  await expect(page.locator(SCREENS.menu)).toBeHidden()
}

/**
 * Begin movement by pressing a direction. Single-player accepts both arrows and
 * WASD; the snake spawns facing RIGHT, so ArrowRight is always a valid first
 * move (never a reversal). Pressing this also starts the game loop, which is
 * what enables pausing.
 */
export async function beginMovement(page: Page, key = 'ArrowRight'): Promise<void> {
  await page.keyboard.press(key)
}
