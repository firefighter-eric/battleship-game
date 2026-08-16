import assert from "node:assert/strict";
import test from "node:test";

import {
  BOARD_SIZE,
  SHIP_DEFS,
  chooseAiTarget,
  coordKey,
  createAiMemory,
  createBoard,
  createSeededRng,
  formatDuration,
  isBoardReady,
  placeShip,
  randomizeBoard,
  resolveShot,
} from "../game-core.js";

test("seeded random layouts always contain the complete non-overlapping fleet", function () {
  for (let seed = 0; seed < 30; seed += 1) {
    const board = createBoard();
    randomizeBoard(board, createSeededRng(seed));
    assert.equal(isBoardReady(board), true);
    assert.equal(board.ships.length, SHIP_DEFS.length);

    const occupied = new Set();
    board.ships.forEach(function checkShip(ship) {
      assert.equal(ship.cells.length, ship.length);
      ship.cells.forEach(function checkCell(cell) {
        assert.ok(cell.x >= 0 && cell.x < BOARD_SIZE);
        assert.ok(cell.y >= 0 && cell.y < BOARD_SIZE);
        const key = coordKey(cell.x, cell.y);
        assert.equal(occupied.has(key), false, "ships must not overlap");
        occupied.add(key);
      });
    });
    assert.equal(occupied.size, 17);
  }
});

test("placement rejects overlap and out-of-bounds coordinates", function () {
  const board = createBoard();
  assert.equal(placeShip(board, "carrier", 0, 0, "horizontal"), true);
  assert.equal(placeShip(board, "battleship", 0, 0, "vertical"), false);
  assert.equal(placeShip(board, "destroyer", 9, 9, "horizontal"), false);
  assert.equal(board.ships.length, 1);
});

test("sinking a ship marks every previously hit segment as sunk", function () {
  const board = createBoard();
  assert.equal(placeShip(board, "destroyer", 0, 0, "horizontal"), true);
  const first = resolveShot(board, 0, 0);
  const second = resolveShot(board, 1, 0);

  assert.equal(first.newlySunk, false);
  assert.equal(second.newlySunk, true);
  assert.deepEqual(board.shots.map(function result(shot) {
    return shot.result;
  }), ["sunk", "sunk"]);
  assert.equal(resolveShot(board, 0, 0).valid, false);
});

test("AI target selection never returns an already attacked coordinate", function () {
  const board = createBoard();
  randomizeBoard(board, createSeededRng(7));
  const rng = createSeededRng(99);
  const memory = createAiMemory(rng);
  const seen = new Set();

  for (let turn = 0; turn < 60; turn += 1) {
    const target = chooseAiTarget(board, "hard", memory, rng);
    const key = coordKey(target.x, target.y);
    assert.equal(seen.has(key), false);
    seen.add(key);
    resolveShot(board, target.x, target.y);
  }
});

test("duration formatting uses real elapsed milliseconds", function () {
  assert.equal(formatDuration(0), "00:00");
  assert.equal(formatDuration(1_999), "00:01");
  assert.equal(formatDuration(65_200), "01:05");
});
