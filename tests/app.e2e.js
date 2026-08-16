import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { chromium } from "playwright";
import { createServer } from "vite";

let server;
let browser;

async function dragWithMouse(page, source, target) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  assert.ok(sourceBox, "drag source must be visible");
  assert.ok(targetBox, "drag target must be visible");
  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY + 10, { steps: 2 });
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
}

async function dragWithTouch(page, sourceSelector, targetSelector) {
  await page.evaluate(function dispatchTouchDrag(selectors) {
    const source = document.querySelector(selectors.sourceSelector);
    const target = document.querySelector(selectors.targetSelector);
    const sourceBox = source.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    const startX = sourceBox.left + sourceBox.width / 2;
    const startY = sourceBox.top + sourceBox.height / 2;
    const endX = targetBox.left + targetBox.width / 2;
    const endY = targetBox.top + targetBox.height / 2;
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      pointerId: 23,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
    };
    source.dispatchEvent(new PointerEvent("pointerdown", { ...eventOptions, clientX: startX, clientY: startY }));
    document.dispatchEvent(new PointerEvent("pointermove", { ...eventOptions, clientX: startX + 10, clientY: startY + 10 }));
    document.dispatchEvent(new PointerEvent("pointermove", { ...eventOptions, clientX: endX, clientY: endY }));
    document.dispatchEvent(new PointerEvent("pointerup", { ...eventOptions, clientX: endX, clientY: endY }));
  }, { sourceSelector: sourceSelector, targetSelector: targetSelector });
}

before(async function startApp() {
  server = await createServer({
    logLevel: "silent",
    server: {
      host: "127.0.0.1",
      port: 4175,
      strictPort: true,
    },
  });
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async function stopApp() {
  if (browser) await browser.close();
  if (server) await server.close();
});

test("theme preference supports day, night, persisted, and system-following modes", async function () {
  const page = await browser.newPage({ viewport: { width: 1360, height: 726 } });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("http://127.0.0.1:4175/?seed=42", { waitUntil: "networkidle" });

  assert.equal(await page.locator("html").getAttribute("data-theme-preference"), "auto");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "night");
  assert.equal(await page.locator('[data-role="theme-select"]').inputValue(), "auto");

  await page.locator('[data-role="theme-select"]').selectOption("day");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "day");
  assert.equal(await page.evaluate(function readSavedTheme() {
    return window.localStorage.getItem("battleship.theme");
  }), "day");
  assert.equal(await page.evaluate(function readDayBackground() {
    return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  }), "#bccdd3");

  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "day");
  assert.equal(await page.locator('[data-role="theme-select"]').inputValue(), "day");

  await page.locator('[data-role="theme-select"]').selectOption("night");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "night");
  assert.equal(await page.evaluate(function readNightBackground() {
    return getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  }), "#161616");

  await page.locator('[data-role="theme-select"]').selectOption("auto");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "night");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(function waitForSystemTheme() {
    return document.documentElement.dataset.theme === "day";
  });
  assert.equal(await page.locator("html").getAttribute("data-theme-preference"), "auto");
  await page.close();
});

test("desktop core flow keeps state, timing, focus, and dialogs coherent", async function () {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  page.on("console", function collectConsole(message) {
    if (message.type() === "error" || message.type() === "warning") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("http://127.0.0.1:4175/?seed=42&test=1", { waitUntil: "networkidle" });
  assert.equal(await page.title(), "海战棋 · 单机战术对决");
  assert.equal(await page.locator('[data-action="start-battle"]').isDisabled(), true);
  assert.equal(await page.locator('button[data-cell-type="player"]').count(), 100);
  assert.equal(await page.locator('button[data-cell-type="enemy"]').count(), 0);

  await page.locator('[data-focus-key="cell:player:0:0"]').click();
  assert.match(await page.locator(".board-summary").first().innerText(), /战列舰/);
  assert.equal(await page.locator('[data-ship-id="battleship"]').getAttribute("aria-pressed"), "true");
  assert.match(await page.locator('[data-role="status-message"]').innerText(), /已自动选择战列舰/);
  assert.equal(await page.locator(".setup-progress strong").innerText(), "1 / 5");
  assert.equal(await page.locator('[data-action="start-battle"]').isDisabled(), true);

  await dragWithMouse(
    page,
    page.locator('[data-cell-type="player"][data-x="0"][data-y="0"]'),
    page.locator('[data-cell-type="player"][data-x="0"][data-y="1"]')
  );
  let draggedLayout = await page.evaluate(function readDraggedLayout() {
    return JSON.parse(window.render_game_to_text()).playerShips;
  });
  assert.deepEqual(draggedLayout.find(function carrier(ship) { return ship.id === "carrier"; }).cells, ["A2", "B2", "C2", "D2", "E2"]);
  assert.match(await page.locator('[data-role="status-message"]').innerText(), /航空母舰已移动到A2/);
  assert.equal(await page.locator('[data-ship-id="battleship"]').getAttribute("aria-pressed"), "true");

  await dragWithMouse(
    page,
    page.locator('[data-ship-id="battleship"]'),
    page.locator('[data-cell-type="player"][data-x="0"][data-y="2"]')
  );
  draggedLayout = await page.evaluate(function readDockDraggedLayout() {
    return JSON.parse(window.render_game_to_text()).playerShips;
  });
  assert.deepEqual(draggedLayout.find(function battleship(ship) { return ship.id === "battleship"; }).cells, ["A3", "B3", "C3", "D3"]);
  assert.equal(await page.locator(".setup-progress strong").innerText(), "2 / 5");
  assert.equal(await page.locator('[data-ship-id="cruiser"]').getAttribute("aria-pressed"), "true");

  const carrierBeforeInvalidDrop = draggedLayout.find(function carrier(ship) { return ship.id === "carrier"; }).cells;
  await dragWithMouse(
    page,
    page.locator('[data-cell-type="player"][data-x="0"][data-y="1"]'),
    page.locator('[data-cell-type="player"][data-x="9"][data-y="9"]')
  );
  draggedLayout = await page.evaluate(function readInvalidDraggedLayout() {
    return JSON.parse(window.render_game_to_text()).playerShips;
  });
  assert.deepEqual(draggedLayout.find(function carrier(ship) { return ship.id === "carrier"; }).cells, carrierBeforeInvalidDrop);
  assert.match(await page.locator('[data-role="status-message"]').innerText(), /已回到原位/);
  assert.equal(await page.locator('[data-ship-id="cruiser"]').getAttribute("aria-pressed"), "true");

  await page.getByRole("button", { name: "随机布阵", exact: true }).click();
  assert.equal(await page.locator('[data-action="start-battle"]').isEnabled(), true);
  await page.getByRole("button", { name: "开始对战", exact: true }).click();
  assert.equal(await page.locator('[data-role="phase-label"]').innerText(), "你的回合");
  assert.equal(await page.locator('button[data-cell-type="player"]').count(), 0);
  assert.equal(await page.locator('button[data-cell-type="enemy"]').count(), 100);

  await page.waitForFunction(function waitForClock() {
    return document.querySelector('[data-role="timer"]')?.textContent !== "00:00";
  }, null, { timeout: 3_000 });
  await page.locator('[data-focus-key="cell:enemy:0:0"]').click();
  await page.waitForFunction(function waitForPlayerTurn() {
    return document.querySelector('[data-role="phase-label"]')?.textContent === "你的回合";
  });
  assert.equal(await page.locator(".main-board-panel .miss, .main-board-panel .hit, .main-board-panel .sunk").count(), 1);
  assert.equal(await page.locator(".mini-board .miss, .mini-board .hit, .mini-board .sunk").count(), 1);
  assert.match(await page.locator(":focus").getAttribute("data-focus-key"), /^cell:enemy:/);

  await page.getByRole("button", { name: "查看规则", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "作战规则" });
  assert.equal(await dialog.isVisible(), true);
  assert.equal(await page.locator("#game-root").getAttribute("inert"), "");
  await page.waitForFunction(function waitForDialogFocus() {
    return document.activeElement?.textContent?.trim() === "知道了";
  });
  assert.equal(await page.locator(":focus").innerText(), "知道了");
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator(":focus").getAttribute("data-focus-key"), "open-rules");

  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  const restartDialog = page.getByRole("dialog", { name: "重新开始？" });
  assert.equal(await restartDialog.isVisible(), true);
  await page.getByRole("button", { name: "返回布阵", exact: true }).click();
  assert.equal(await page.locator('[data-role="phase-label"]').innerText(), "布阵 0/5");
  assert.equal(await page.locator('[data-action="start-battle"]').isDisabled(), true);

  await page.getByRole("button", { name: "随机布阵", exact: true }).click();
  await page.getByRole("button", { name: "开始对战", exact: true }).click();
  const firstLayout = await page.evaluate(function readLayout() {
    return JSON.parse(window.render_game_to_text()).playerShips;
  });
  await page.waitForTimeout(1_100);
  await page.evaluate(function forceWin() {
    window.__BATTLESHIP_TEST__.finish("player");
  });
  const resultDialog = page.getByRole("dialog", { name: "胜利" });
  assert.equal(await resultDialog.isVisible(), true);
  const resultDuration = resultDialog.locator(".result-metric").filter({ hasText: "对局时长" }).locator("strong");
  assert.notEqual(await resultDuration.innerText(), "00:00");

  await page.getByRole("button", { name: "沿用布阵再战", exact: true }).click();
  assert.equal(await page.locator('[data-role="phase-label"]').innerText(), "你的回合");
  const rematchLayout = await page.evaluate(function readRematchLayout() {
    return JSON.parse(window.render_game_to_text()).playerShips;
  });
  assert.deepEqual(rematchLayout, firstLayout);

  await page.evaluate(function forceLoss() {
    window.__BATTLESHIP_TEST__.finish("ai");
  });
  assert.equal(await page.getByRole("dialog", { name: "失败" }).isVisible(), true);
  await page.getByRole("button", { name: "重新布阵", exact: true }).click();
  assert.equal(await page.locator('[data-role="phase-label"]').innerText(), "布阵 0/5");
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test("fleet overview keeps enemy status and own ship health visible together", async function () {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on("console", function collectConsole(message) {
    if (message.type() === "error" || message.type() === "warning") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("http://127.0.0.1:4175/?seed=42&test=1", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "随机布阵", exact: true }).click();
  await page.getByRole("button", { name: "开始对战", exact: true }).click();

  const fleet = page.locator('[data-role="fleet-overview"]');
  assert.equal(await fleet.locator(".fleet-overview-row").count(), 5);
  assert.equal(await fleet.locator('[data-state="afloat"]').count(), 5);
  assert.equal(await fleet.locator('[data-state="sunk"]').count(), 0);
  assert.equal(await fleet.locator('[data-player-state="afloat"]').count(), 5);
  assert.equal(await fleet.locator('[data-ship-status="carrier"] .fleet-count').last().innerText(), "5/5");
  assert.equal(await fleet.locator('[data-ship-status="carrier"] .health-segments span').count(), 5);
  assert.match(await page.locator(".fleet-panel .board-summary").innerText(), /敌 5 · 我 5/);

  const sunk = await page.evaluate(function sinkEnemyDestroyer() {
    return window.__BATTLESHIP_TEST__.sinkEnemy("destroyer");
  });
  assert.equal(sunk, true);
  assert.equal(await fleet.locator('[data-state="sunk"]').count(), 1);
  assert.equal(await fleet.locator('[data-state="afloat"]').count(), 4);
  assert.match(await fleet.locator('[data-ship-status="destroyer"]').innerText(), /驱逐舰.*已沉没/s);
  assert.equal(await fleet.locator('[data-ship-status="destroyer"]').getAttribute("aria-label"), "驱逐舰，敌方已击沉，己方剩余2/2");
  assert.match(await page.locator(".fleet-panel .board-summary").innerText(), /敌 4 · 我 5/);
  assert.match(await page.locator('[data-role="status-message"]').innerText(), /驱逐舰已击沉/);
  assert.equal(await page.locator(".main-board-panel .sunk").count(), 2);

  const ownSunk = await page.evaluate(function sinkOwnSubmarine() {
    return window.__BATTLESHIP_TEST__.sinkPlayer("submarine");
  });
  assert.equal(ownSunk, true);
  assert.equal(await fleet.locator('[data-player-state="sunk"]').count(), 1);
  assert.equal(await fleet.locator('[data-ship-status="submarine"] .fleet-count').last().innerText(), "0/3");
  assert.equal(await fleet.locator('[data-ship-status="submarine"] .health-segments .hit').count(), 3);
  assert.equal(await fleet.locator('[data-ship-status="submarine"]').getAttribute("aria-label"), "潜艇，敌方仍在役，己方剩余0/3");
  assert.match(await page.locator(".fleet-panel .board-summary").innerText(), /敌 4 · 我 4/);
  assert.match(await page.locator('[data-role="status-message"]').innerText(), /己方潜艇已沉没/);
  assert.equal(await page.locator(".mini-board .sunk").count(), 3);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});

test("mobile setup keeps the board and primary controls in the first viewport without overflow", async function () {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:4175/?seed=42", { waitUntil: "networkidle" });

  const metrics = await page.evaluate(function measureMobile() {
    const board = document.querySelector(".main-board-panel .board-grid").getBoundingClientRect();
    const start = document.querySelector('[data-action="start-battle"]').getBoundingClientRect();
    const status = document.querySelector(".status-bar").getBoundingClientRect();
    const theme = document.querySelector('[data-role="theme-select"]').getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      boardTop: board.top,
      boardBottom: board.bottom,
      startBottom: start.bottom,
      statusTop: status.top,
      themeRight: theme.right,
    };
  });

  assert.equal(metrics.pageWidth, metrics.viewportWidth);
  assert.ok(metrics.boardTop < 160);
  assert.ok(metrics.boardBottom < 520);
  assert.ok(metrics.startBottom <= 844);
  assert.ok(metrics.startBottom <= metrics.statusTop);
  assert.ok(metrics.themeRight <= metrics.viewportWidth);

  await dragWithTouch(
    page,
    '[data-ship-id="carrier"]',
    '[data-cell-type="player"][data-x="0"][data-y="0"]'
  );
  const touchLayout = await page.evaluate(function readTouchLayout() {
    return JSON.parse(window.render_game_to_text()).playerShips;
  });
  assert.deepEqual(touchLayout.find(function carrier(ship) { return ship.id === "carrier"; }).cells, ["A1", "B1", "C1", "D1", "E1"]);
  assert.equal(await page.locator(".setup-progress strong").innerText(), "1 / 5");
  assert.equal(await page.locator('[data-ship-id="battleship"]').getAttribute("aria-pressed"), "true");
  await page.close();
});

test("short desktop setup keeps the status hint clear of the board and setup rail", async function () {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto("http://127.0.0.1:4175/?seed=42", { waitUntil: "networkidle" });

  const metrics = await page.evaluate(function measureSetupSpacing() {
    const board = document.querySelector(".main-board-panel .board-grid").getBoundingClientRect();
    const rail = document.querySelector(".setup-panel").getBoundingClientRect();
    const status = document.querySelector(".status-bar").getBoundingClientRect();
    const help = document.querySelector(".setup-help");
    return {
      boardBottom: board.bottom,
      railBottom: rail.bottom,
      statusTop: status.top,
      helpDisplay: getComputedStyle(help).display,
    };
  });

  assert.ok(metrics.boardBottom <= metrics.statusTop + 1);
  assert.ok(metrics.railBottom <= metrics.statusTop + 1);
  assert.equal(metrics.helpDisplay, "none");
  await page.close();
});

test("short desktop battle keeps the complete own board and battle log visible", async function () {
  const page = await browser.newPage({ viewport: { width: 1360, height: 726 } });
  const consoleErrors = [];
  page.on("console", function collectConsole(message) {
    if (message.type() === "error" || message.type() === "warning") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("http://127.0.0.1:4175/?seed=42", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "随机布阵", exact: true }).click();
  await page.getByRole("button", { name: "开始对战", exact: true }).click();

  const metrics = await page.evaluate(function measureOwnBoard() {
    const fleetPanel = document.querySelector(".fleet-panel").getBoundingClientRect();
    const fleetRows = document.querySelectorAll('[data-role="fleet-overview"] .fleet-overview-row');
    const lastFleetRow = fleetRows[fleetRows.length - 1].getBoundingClientRect();
    const panel = document.querySelector(".mini-board-panel").getBoundingClientRect();
    const board = document.querySelector(".mini-board .board-grid").getBoundingClientRect();
    const cells = document.querySelectorAll('.mini-board .board-grid [role="gridcell"]');
    const lastCell = cells[cells.length - 1].getBoundingClientRect();
    const log = document.querySelector(".battle-log").getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      fleetPanelBottom: fleetPanel.bottom,
      lastFleetRowBottom: lastFleetRow.bottom,
      panelBottom: panel.bottom,
      boardBottom: board.bottom,
      lastCellBottom: lastCell.bottom,
      logBottom: log.bottom,
      logHeight: log.height,
    };
  });

  assert.ok(metrics.lastFleetRowBottom <= metrics.fleetPanelBottom + 1);
  assert.ok(metrics.boardBottom <= metrics.panelBottom + 1);
  assert.ok(metrics.lastCellBottom <= metrics.panelBottom + 1);
  assert.ok(metrics.logBottom <= metrics.viewportHeight);
  assert.ok(metrics.logHeight >= 72);
  assert.equal(await page.locator('[data-role="fleet-overview"] .fleet-overview-row').count(), 5);
  assert.equal(await page.locator(".mini-board .board-grid").getByRole("gridcell").count(), 100);
  assert.deepEqual(consoleErrors, []);
  await page.close();
});
