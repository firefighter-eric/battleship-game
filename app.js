import {
  BOARD_SIZE,
  LETTERS,
  SHIP_DEFS,
  allShipsSunk,
  canPlaceShip,
  chooseAiTarget,
  clonePlacementBoard,
  coordKey,
  createAiMemory,
  createBoard,
  createSeededRng,
  formatCoord,
  formatDuration,
  getPlacedShip,
  getShotAt,
  getUnplacedShipDefs,
  isBoardReady,
  placeShip,
  randomizeBoard,
  rememberAiShot,
  removeShip,
  resolveShot,
} from "./game-core.js";

const app = document.getElementById("app");
const gameRoot = document.getElementById("game-root");
const modalRoot = document.getElementById("modal-root");
const liveRegion = document.getElementById("live-region");
const phaseLabel = document.querySelector('[data-role="phase-label"]');
const turnIndicator = document.querySelector('[data-role="turn-indicator"]');
const statusMessage = document.querySelector('[data-role="status-message"]');
const timerElement = document.querySelector('[data-role="timer"]');
const difficultySelect = document.querySelector('[data-role="difficulty-select"]');
const themeSelect = document.querySelector('[data-role="theme-select"]');
const soundButton = document.querySelector('[data-action="toggle-sound"]');

const seedParam = Number(new URLSearchParams(window.location.search).get("seed"));
const seed = Number.isFinite(seedParam) && seedParam >= 0 ? seedParam : Date.now();
const rng = createSeededRng(seed);
const savedDifficulty = window.localStorage.getItem("battleship.difficulty");
const savedSound = window.localStorage.getItem("battleship.sound");
const savedTheme = window.localStorage.getItem("battleship.theme");
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let themePreference = ["auto", "day", "night"].includes(savedTheme) ? savedTheme : "auto";

function resolvedTheme() {
  if (themePreference === "auto") return systemThemeQuery.matches ? "night" : "day";
  return themePreference;
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = themePreference;
  themeSelect.value = themePreference;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = theme === "night" ? "#161616" : "#BCCDD3";
}

const SOUND_PRESETS = {
  miss: [
    { type: "triangle", frequency: 215, duration: 0.08, gain: 0.045 },
    { type: "sine", frequency: 155, duration: 0.16, gain: 0.035, delay: 0.06 },
  ],
  hit: [
    { type: "square", frequency: 340, duration: 0.06, gain: 0.045 },
    { type: "square", frequency: 470, duration: 0.09, gain: 0.04, delay: 0.05 },
  ],
  sunk: [
    { type: "sawtooth", frequency: 225, duration: 0.08, gain: 0.04 },
    { type: "square", frequency: 350, duration: 0.09, gain: 0.045, delay: 0.05 },
    { type: "triangle", frequency: 145, duration: 0.28, gain: 0.05, delay: 0.12 },
  ],
};

let audioContext = null;
let aiTimer = null;
let clockTimer = null;
let lastAnnouncement = "";
let activeShipDrag = null;
let suppressNextClick = false;

const SHIP_DRAG_THRESHOLD = 6;

const state = {
  phase: "setup",
  currentTurn: "player",
  difficulty: ["easy", "medium", "hard"].includes(savedDifficulty) ? savedDifficulty : "medium",
  orientation: "horizontal",
  selectedShipId: SHIP_DEFS[0].id,
  playerBoard: createBoard(),
  enemyBoard: createBoard(),
  preview: null,
  message: "选择舰船并完成布阵。",
  log: [],
  stats: createStats(),
  aiMemory: createAiMemory(rng),
  soundEnabled: savedSound !== "false",
  modal: null,
  modalOpenerKey: null,
  modalNeedsFocus: false,
  flashCells: new Set(),
  focusAfterRender: null,
  keyboardCursor: {
    player: { x: 0, y: 0 },
    enemy: { x: 0, y: 0 },
  },
};

randomizeBoard(state.enemyBoard, rng);

function createStats() {
  return {
    turns: 0,
    playerShots: 0,
    playerHits: 0,
    aiShots: 0,
    aiHits: 0,
    playerSunk: 0,
    aiSunk: 0,
    startedAt: null,
    elapsedMs: 0,
  };
}

function elapsedMs() {
  if (state.phase === "battle" && state.stats.startedAt !== null) {
    return Math.max(0, Date.now() - state.stats.startedAt);
  }
  return state.stats.elapsedMs;
}

function accuracy(hits, shots) {
  if (!shots) return "0%";
  return String(Math.round((hits / shots) * 100)) + "%";
}

function difficultyLabel(value) {
  if (value === "easy") return "简单";
  if (value === "hard") return "困难";
  return "普通";
}

function resultLabel(result) {
  if (result === "hit") return "命中";
  if (result === "sunk") return "击沉";
  return "未命中";
}

function activateNextUnplacedShip(preferredShipId) {
  const unplacedShips = getUnplacedShipDefs(state.playerBoard);
  const preferredShip = preferredShipId
    ? unplacedShips.find(function findPreferredShip(shipDef) {
      return shipDef.id === preferredShipId;
    })
    : null;
  const nextShip = preferredShip || unplacedShips[0] || null;
  state.selectedShipId = nextShip ? nextShip.id : null;
  return nextShip;
}

function startClock() {
  stopClock();
  renderTimer();
  clockTimer = window.setInterval(renderTimer, 500);
}

function stopClock() {
  if (clockTimer !== null) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }
}

function clearAiTimer() {
  if (aiTimer !== null) {
    window.clearTimeout(aiTimer);
    aiTimer = null;
  }
}

function renderTimer() {
  timerElement.textContent = formatDuration(elapsedMs());
}

function setMessage(message, announce) {
  state.message = message;
  if (announce !== false && message !== lastAnnouncement) {
    lastAnnouncement = message;
    liveRegion.textContent = "";
    window.requestAnimationFrame(function announceMessage() {
      liveRegion.textContent = message;
    });
  }
}

function pushLog(actor, coord, result, shipName) {
  state.log.unshift({
    actor: actor,
    coord: coord || "—",
    result: result,
    shipName: shipName || "",
    at: elapsedMs(),
  });
  state.log = state.log.slice(0, 18);
}

function ensureAudioContext() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume().catch(function ignore() {});
    return audioContext;
  }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  audioContext = new AudioContextConstructor();
  if (audioContext.state === "suspended") audioContext.resume().catch(function ignore() {});
  return audioContext;
}

function playSound(name) {
  if (!state.soundEnabled) return;
  const context = ensureAudioContext();
  const preset = SOUND_PRESETS[name];
  if (!context || !preset) return;

  const startAt = context.currentTime + 0.01;
  preset.forEach(function playTone(tone) {
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();
    const toneStart = startAt + (tone.delay || 0);
    const toneEnd = toneStart + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
    gainNode.gain.setValueAtTime(0.0001, toneStart);
    gainNode.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
    oscillator.connect(gainNode);
    gainNode.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.02);
  });
}

function resetToSetup() {
  clearAiTimer();
  stopClock();
  state.phase = "setup";
  state.currentTurn = "player";
  state.orientation = "horizontal";
  state.selectedShipId = SHIP_DEFS[0].id;
  state.playerBoard = createBoard();
  state.enemyBoard = createBoard();
  randomizeBoard(state.enemyBoard, rng);
  state.preview = null;
  state.log = [];
  state.stats = createStats();
  state.aiMemory = createAiMemory(rng);
  state.flashCells.clear();
  state.keyboardCursor.player = { x: 0, y: 0 };
  state.keyboardCursor.enemy = { x: 0, y: 0 };
  state.modal = null;
  setMessage("选择舰船并完成布阵。");
  render();
}

function beginBattle(playerLayout) {
  clearAiTimer();
  stopClock();
  state.playerBoard = clonePlacementBoard(playerLayout);
  state.enemyBoard = createBoard();
  randomizeBoard(state.enemyBoard, rng);
  state.phase = "battle";
  state.currentTurn = "player";
  state.preview = null;
  state.log = [];
  state.stats = createStats();
  state.stats.startedAt = Date.now();
  state.aiMemory = createAiMemory(rng);
  state.flashCells.clear();
  state.keyboardCursor.enemy = firstAvailableEnemyCell();
  state.modal = null;
  setMessage("你的回合：选择敌方海域的坐标发起攻击。");
  pushLog("系统", "—", "对局开始", difficultyLabel(state.difficulty));
  render();
  startClock();
}

function startBattle() {
  if (!isBoardReady(state.playerBoard)) {
    const nextShip = getUnplacedShipDefs(state.playerBoard)[0];
    setMessage(nextShip ? "还需部署：" + nextShip.name : "请完成舰队部署。");
    render();
    return;
  }
  beginBattle(state.playerBoard);
}

function rematchWithSameLayout() {
  const layout = clonePlacementBoard(state.playerBoard);
  closeModal(false);
  beginBattle(layout);
}

function completeGame(winner) {
  state.stats.elapsedMs = elapsedMs();
  state.stats.startedAt = null;
  state.phase = "result";
  state.currentTurn = null;
  stopClock();
  clearAiTimer();
  const playerWon = winner === "player";
  setMessage(playerWon ? "敌方舰队全灭，作战胜利。" : "己方舰队全灭，本局失败。");
  pushLog("系统", "—", playerWon ? "作战胜利" : "作战失败", "");
  state.modal = "result";
  state.modalNeedsFocus = true;
  render();
}

function markFlash(boardType, x, y) {
  const key = boardType + ":" + coordKey(x, y);
  state.flashCells.add(key);
  window.setTimeout(function clearFlash() {
    state.flashCells.delete(key);
    const cell = document.querySelector('[data-flash-key="' + key + '"]');
    if (cell) cell.classList.remove("flash");
  }, 650);
}

function attackEnemy(x, y) {
  if (state.phase !== "battle" || state.currentTurn !== "player") return;
  const outcome = resolveShot(state.enemyBoard, x, y);
  if (!outcome.valid) {
    setMessage("该坐标已经攻击过，请选择其他坐标。");
    render();
    return;
  }

  state.stats.turns += 1;
  state.stats.playerShots += 1;
  if (outcome.shot.result !== "miss") state.stats.playerHits += 1;
  if (outcome.newlySunk) state.stats.playerSunk += 1;
  state.currentTurn = "ai";
  markFlash("enemy", x, y);
  playSound(outcome.shot.result);
  pushLog("你", formatCoord(x, y), resultLabel(outcome.shot.result), outcome.newlySunk && outcome.ship ? outcome.ship.name : "");
  setMessage("攻击 " + formatCoord(x, y) + "：" + resultLabel(outcome.shot.result) + (outcome.newlySunk && outcome.ship ? " · " + outcome.ship.name : ""));

  if (allShipsSunk(state.enemyBoard)) {
    completeGame("player");
    return;
  }

  state.keyboardCursor.enemy = firstAvailableEnemyCell();
  state.focusAfterRender = "cell:enemy:" + state.keyboardCursor.enemy.x + ":" + state.keyboardCursor.enemy.y;
  render();
  aiTimer = window.setTimeout(runAiTurn, 650);
}

function runAiTurn() {
  aiTimer = null;
  if (state.phase !== "battle") return;
  const target = chooseAiTarget(state.playerBoard, state.difficulty, state.aiMemory, rng);
  if (!target) return;

  const outcome = resolveShot(state.playerBoard, target.x, target.y);
  if (!outcome.valid) {
    aiTimer = window.setTimeout(runAiTurn, 20);
    return;
  }
  state.stats.aiShots += 1;
  if (outcome.shot.result !== "miss") state.stats.aiHits += 1;
  if (outcome.newlySunk) state.stats.aiSunk += 1;
  rememberAiShot(state.playerBoard, state.aiMemory, outcome.shot);
  markFlash("player", target.x, target.y);
  playSound(outcome.shot.result);
  pushLog("AI", formatCoord(target.x, target.y), resultLabel(outcome.shot.result), outcome.newlySunk && outcome.ship ? outcome.ship.name : "");

  if (allShipsSunk(state.playerBoard)) {
    completeGame("ai");
    return;
  }

  state.currentTurn = "player";
  setMessage("AI 攻击 " + formatCoord(target.x, target.y) + "：" + resultLabel(outcome.shot.result) + "。轮到你了。");
  state.focusAfterRender = "cell:enemy:" + state.keyboardCursor.enemy.x + ":" + state.keyboardCursor.enemy.y;
  render();
}

function firstAvailableEnemyCell() {
  const current = state.keyboardCursor.enemy;
  if (!getShotAt(state.enemyBoard, current.x, current.y)) return { x: current.x, y: current.y };
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!getShotAt(state.enemyBoard, x, y)) return { x: x, y: y };
    }
  }
  return { x: 0, y: 0 };
}

function selectShip(shipId) {
  if (state.phase !== "setup") return;
  const placed = getPlacedShip(state.playerBoard, shipId);
  if (placed) {
    removeShip(state.playerBoard, shipId);
    state.preview = {
      cells: placed.cells,
      valid: true,
    };
    setMessage("已取回" + placed.name + "，请选择新的部署位置。");
  } else {
    state.preview = null;
    const shipDef = SHIP_DEFS.find(function findDefinition(definition) {
      return definition.id === shipId;
    });
    setMessage("已选择" + shipDef.name + "，方向为" + (state.orientation === "horizontal" ? "横向" : "纵向") + "。");
  }
  state.selectedShipId = shipId;
  state.focusAfterRender = "ship:" + shipId;
  render();
}

function getPlayerShipAt(x, y) {
  return state.playerBoard.ships.find(function shipAtCoordinate(ship) {
    return ship.cells.some(function matchesCoordinate(cell) {
      return cell.x === x && cell.y === y;
    });
  }) || null;
}

function getPlayerCellAtPoint(clientX, clientY) {
  const cell = document.elementsFromPoint(clientX, clientY).find(function findPlayerCell(element) {
    return element.matches && element.matches('[data-cell-type="player"]');
  });
  if (!cell) return null;
  return {
    element: cell,
    x: Number(cell.dataset.x),
    y: Number(cell.dataset.y),
  };
}

function clearDragPreview() {
  document.querySelectorAll('.setup-layout [data-cell-type="player"].preview, .setup-layout [data-cell-type="player"].invalid').forEach(function clearCellPreview(cell) {
    cell.classList.remove("preview", "invalid");
  });
  const board = document.querySelector(".setup-layout .board-grid");
  if (board) delete board.dataset.dropState;
}

function paintDragPreview(candidate) {
  clearDragPreview();
  const board = document.querySelector(".setup-layout .board-grid");
  if (!board || !candidate) return;
  board.dataset.dropState = candidate.ok ? "valid" : "invalid";
  candidate.cells.forEach(function paintCandidateCell(cell) {
    const target = document.querySelector('[data-cell-type="player"][data-x="' + String(cell.x) + '"][data-y="' + String(cell.y) + '"]');
    if (target) target.classList.add(candidate.ok ? "preview" : "invalid");
  });
}

function createShipDragGhost(shipDef, orientation) {
  const ghost = document.createElement("div");
  ghost.className = "ship-drag-ghost " + orientation;
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = '<span class="ship-drag-name">' + shipDef.name + '</span><span class="ship-drag-segments">' + Array.from({ length: shipDef.length }, function ghostSegment() {
    return "<span></span>";
  }).join("") + "</span>";
  document.body.appendChild(ghost);
  return ghost;
}

function positionShipDragGhost(drag, clientX, clientY) {
  if (!drag.ghost) return;
  drag.ghost.style.transform = "translate3d(" + String(clientX + 14) + "px, " + String(clientY + 14) + "px, 0)";
}

function beginShipDrag(drag, event) {
  drag.dragging = true;
  state.selectedShipId = drag.shipId;
  state.orientation = drag.orientation;
  state.preview = null;
  clearDragPreview();
  document.body.classList.add("is-ship-dragging");
  drag.sourceElement.classList.add("drag-source");
  drag.ghost = createShipDragGhost(drag.shipDef, drag.orientation);
  try {
    drag.sourceElement.setPointerCapture(event.pointerId);
  } catch (_error) {
    // Pointer capture is an enhancement; document-level listeners keep drag working.
  }
  setMessage("正在拖动" + drag.shipDef.name + "，松开即可部署。", false);
  statusMessage.textContent = state.message;
}

function updateShipDrag(drag, event) {
  positionShipDragGhost(drag, event.clientX, event.clientY);
  const hoveredCell = getPlayerCellAtPoint(event.clientX, event.clientY);
  if (!hoveredCell) {
    drag.drop = null;
    state.preview = null;
    paintDragPreview(null);
    if (drag.ghost) delete drag.ghost.dataset.valid;
    return;
  }

  const originX = hoveredCell.x - drag.anchorX;
  const originY = hoveredCell.y - drag.anchorY;
  const candidate = canPlaceShip(
    state.playerBoard,
    drag.shipDef,
    originX,
    originY,
    drag.orientation,
    drag.shipId
  );
  drag.drop = { x: originX, y: originY, candidate: candidate };
  state.preview = candidate;
  paintDragPreview(candidate);
  if (drag.ghost) drag.ghost.dataset.valid = String(candidate.ok);
}

function cleanupShipDrag(drag) {
  clearDragPreview();
  document.body.classList.remove("is-ship-dragging");
  drag.sourceElement.classList.remove("drag-source");
  if (drag.ghost) drag.ghost.remove();
  try {
    if (drag.sourceElement.hasPointerCapture(drag.pointerId)) {
      drag.sourceElement.releasePointerCapture(drag.pointerId);
    }
  } catch (_error) {
    // The source can disappear during a rerender; there is nothing left to release.
  }
}

function finishShipDrag(drag, cancelled) {
  const validDrop = !cancelled && drag.drop && drag.drop.candidate.ok;
  cleanupShipDrag(drag);
  state.preview = null;

  if (validDrop) {
    placeShip(state.playerBoard, drag.shipId, drag.drop.x, drag.drop.y, drag.orientation);
    state.orientation = drag.orientation;
    state.focusAfterRender = "cell:player:" + String(drag.drop.x) + ":" + String(drag.drop.y);
    const nextShip = activateNextUnplacedShip(drag.wasPlaced ? drag.previousSelectedShipId : null);
    if (drag.wasPlaced) {
      setMessage(drag.shipDef.name + "已移动到" + formatCoord(drag.drop.x, drag.drop.y) + (nextShip ? "，继续部署" + nextShip.name + "。" : "，舰队部署完成。"));
    } else {
      setMessage(drag.shipDef.name + "已部署到" + formatCoord(drag.drop.x, drag.drop.y) + (nextShip ? "，已自动选择" + nextShip.name + "。" : "，舰队部署完成。"));
    }
  } else {
    state.selectedShipId = drag.wasPlaced ? drag.previousSelectedShipId : drag.shipId;
    state.orientation = drag.previousOrientation;
    if (cancelled) {
      setMessage("已取消拖动，舰船位置保持不变。");
    } else if (drag.wasPlaced) {
      setMessage("该位置无法部署，" + drag.shipDef.name + "已回到原位。");
    } else {
      setMessage("该位置无法部署，请把" + drag.shipDef.name + "拖到棋盘内的空白区域。");
    }
  }
  render();
}

function suppressSyntheticDragClick() {
  suppressNextClick = true;
  window.setTimeout(function clearSyntheticClickGuard() {
    suppressNextClick = false;
  }, 0);
}

function createShipDrag(event) {
  if (state.phase !== "setup" || state.modal || !event.isPrimary) return null;
  if (event.pointerType === "mouse" && event.button !== 0) return null;

  const shipOption = event.target.closest && event.target.closest("[data-ship-id]");
  if (shipOption) {
    const shipId = shipOption.dataset.shipId;
    const shipDef = SHIP_DEFS.find(function findDefinition(definition) {
      return definition.id === shipId;
    });
    const placedShip = getPlacedShip(state.playerBoard, shipId);
    return {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sourceElement: shipOption,
      shipId: shipId,
      shipDef: shipDef,
      orientation: placedShip ? placedShip.orientation : state.orientation,
      anchorX: 0,
      anchorY: 0,
      wasPlaced: Boolean(placedShip),
      previousSelectedShipId: state.selectedShipId,
      previousOrientation: state.orientation,
      dragging: false,
      drop: null,
      ghost: null,
    };
  }

  const cell = event.target.closest && event.target.closest('[data-cell-type="player"]');
  if (!cell) return null;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  const placedShip = getPlayerShipAt(x, y);
  if (!placedShip) return null;
  const shipDef = SHIP_DEFS.find(function findDefinition(definition) {
    return definition.id === placedShip.id;
  });
  const origin = placedShip.cells[0];
  return {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    sourceElement: cell,
    shipId: placedShip.id,
    shipDef: shipDef,
    orientation: placedShip.orientation,
    anchorX: x - origin.x,
    anchorY: y - origin.y,
    wasPlaced: true,
    previousSelectedShipId: state.selectedShipId,
    previousOrientation: state.orientation,
    dragging: false,
    drop: null,
    ghost: null,
  };
}

function handlePlayerCell(x, y) {
  if (state.phase !== "setup") return;
  const existingShip = state.playerBoard.ships.find(function shipAtCell(ship) {
    return ship.cells.some(function matchesCell(cell) {
      return cell.x === x && cell.y === y;
    });
  });
  if (existingShip) {
    removeShip(state.playerBoard, existingShip.id);
    state.selectedShipId = existingShip.id;
    state.preview = { cells: existingShip.cells, valid: true };
    setMessage("已取回" + existingShip.name + "，请选择新的位置。");
    state.focusAfterRender = "cell:player:" + x + ":" + y;
    render();
    return;
  }

  if (!state.selectedShipId) {
    setMessage(isBoardReady(state.playerBoard) ? "舰队部署完成，可以开始对战。" : "请先从右侧舰船坞选择下一艘舰船。");
    render();
    return;
  }

  const shipDef = SHIP_DEFS.find(function findDefinition(definition) {
    return definition.id === state.selectedShipId;
  });
  const candidate = canPlaceShip(state.playerBoard, shipDef, x, y, state.orientation, shipDef.id);
  if (!candidate.ok) {
    state.preview = { cells: candidate.cells, valid: false };
    setMessage("该位置越界或与其他舰船重叠，请换一个坐标。");
    state.focusAfterRender = "cell:player:" + x + ":" + y;
    render();
    return;
  }

  placeShip(state.playerBoard, shipDef.id, x, y, state.orientation);
  state.preview = null;
  const nextShip = activateNextUnplacedShip();
  setMessage(nextShip ? shipDef.name + "已部署，已自动选择" + nextShip.name + "。" : "舰队部署完成，可以开始对战。");
  state.focusAfterRender = "cell:player:" + x + ":" + y;
  render();
}

function rotatePlacement() {
  if (state.phase !== "setup") return;
  state.orientation = state.orientation === "horizontal" ? "vertical" : "horizontal";
  state.preview = null;
  setMessage("舰船方向已切换为" + (state.orientation === "horizontal" ? "横向" : "纵向") + "。");
  render();
}

function randomizePlayer() {
  if (state.phase !== "setup") return;
  randomizeBoard(state.playerBoard, rng);
  state.selectedShipId = null;
  state.preview = null;
  setMessage("随机布阵完成，可以直接开始对战。");
  render();
}

function resetPlayerPlacement() {
  if (state.phase !== "setup") return;
  state.playerBoard = createBoard();
  state.selectedShipId = SHIP_DEFS[0].id;
  state.orientation = "horizontal";
  state.preview = null;
  setMessage("已清空部署，请重新布阵。");
  render();
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  window.localStorage.setItem("battleship.sound", String(state.soundEnabled));
  if (state.soundEnabled) ensureAudioContext();
  setMessage(state.soundEnabled ? "声音已开启。" : "声音已关闭。");
  updateHeader();
}

function openModal(type) {
  const activeElement = document.activeElement;
  state.modalOpenerKey = activeElement && activeElement.dataset ? activeElement.dataset.focusKey || null : null;
  state.modal = type;
  state.modalNeedsFocus = true;
  renderModal();
}

function closeModal(restoreFocus) {
  if (state.modal === "result") return;
  const openerKey = state.modalOpenerKey;
  state.modal = null;
  state.modalNeedsFocus = false;
  renderModal();
  if (restoreFocus !== false && openerKey) {
    const opener = document.querySelector('[data-focus-key="' + openerKey + '"]');
    if (opener) opener.focus({ preventScroll: true });
  }
}

function render() {
  const previousFocusKey = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.focusKey
    : null;
  updateHeader();
  app.innerHTML = state.phase === "setup" ? renderSetup() : renderBattle();
  statusMessage.textContent = state.message;
  renderTimer();
  renderModal();

  const focusKey = state.focusAfterRender || previousFocusKey;
  state.focusAfterRender = null;
  if (!state.modal && focusKey) {
    const nextFocus = document.querySelector('[data-focus-key="' + focusKey + '"]');
    if (nextFocus && !nextFocus.disabled) nextFocus.focus({ preventScroll: true });
  }
}

function updateHeader() {
  let label = "布阵 " + state.playerBoard.ships.length + "/" + SHIP_DEFS.length;
  if (state.phase === "battle") label = state.currentTurn === "player" ? "你的回合" : "AI 思考中";
  if (state.phase === "result") label = "结算阶段";
  phaseLabel.textContent = label;
  turnIndicator.dataset.state = state.phase === "battle" ? state.currentTurn : state.phase;
  difficultySelect.value = state.difficulty;
  difficultySelect.disabled = state.phase !== "setup";
  soundButton.setAttribute("aria-pressed", String(state.soundEnabled));
  soundButton.setAttribute("aria-label", state.soundEnabled ? "关闭声音" : "开启声音");
}

function renderSetup() {
  const placedCount = state.playerBoard.ships.length;
  const ready = isBoardReady(state.playerBoard);
  const selectedShip = state.selectedShipId
    ? SHIP_DEFS.find(function findDefinition(definition) {
      return definition.id === state.selectedShipId;
    })
    : null;
  const currentLabel = selectedShip ? selectedShip.name : ready ? "部署完成" : "请选择下一艘";

  return [
    '<section class="battlefield setup-layout" data-phase="setup">',
      '<section class="board-panel main-board-panel">',
        '<header class="panel-heading">',
          '<div><span class="panel-kicker">部署海域</span><h2>己方海域</h2></div>',
          '<div class="board-summary">方向 <strong>', state.orientation === "horizontal" ? "横向" : "纵向", '</strong> · 当前 <strong>', currentLabel, '</strong></div>',
        '</header>',
        '<div class="board-wrap">', buildBoard(state.playerBoard, "player", true, true, false), '</div>',
      '</section>',
      '<aside class="side-rail setup-rail">',
        '<section class="rail-panel setup-panel">',
          '<header class="setup-heading">',
            '<div><span class="panel-kicker">舰队配置</span><h2>部署舰队</h2></div>',
            '<span class="key-hint"><kbd>R</kbd> 旋转</span>',
          '</header>',
          '<div class="setup-progress">',
            '<div class="progress-track"><span style="--progress: ', String((placedCount / SHIP_DEFS.length) * 100), '%"></span></div>',
            '<strong>', String(placedCount), ' / ', String(SHIP_DEFS.length), '</strong>',
          '</div>',
          '<p class="drag-tip" id="drag-instructions">拖动舰船到棋盘；已部署舰船也可直接拖动调整</p>',
          '<div class="ship-dock" aria-label="舰船选择" aria-describedby="drag-instructions">', renderShipDock(), '</div>',
          '<div class="setup-actions">',
            '<button class="quiet-button ', state.orientation === "horizontal" ? "active" : "", '" type="button" data-action="rotate" data-focus-key="rotate">', state.orientation === "horizontal" ? "横向" : "纵向", '</button>',
            '<button class="quiet-button" type="button" data-action="randomize" data-focus-key="randomize">随机布阵</button>',
            '<button class="quiet-button" type="button" data-action="reset-placement" data-focus-key="reset-placement">重置</button>',
          '</div>',
          '<button class="primary-button start-button" type="button" data-action="start-battle" data-focus-key="start-battle" ', ready ? "" : "disabled", '>开始对战</button>',
        '</section>',
        '<section class="rail-panel setup-help">',
          '<p><strong>部署方法</strong>　将舰船拖到棋盘，也可先选择舰船再点击坐标。拖动已部署舰船可直接调整位置。</p>',
          '<p><strong>胜利条件</strong>　率先击沉对方全部五艘舰船。布阵阶段允许舰船相邻。</p>',
        '</section>',
      '</aside>',
    '</section>',
  ].join("");
}

function renderBattle() {
  const enemyRemaining = state.enemyBoard.ships.filter(function remains(ship) {
    return ship.hits.length < ship.length;
  }).length;
  return [
    '<section class="battlefield battle-layout" data-phase="', state.phase, '">',
      '<section class="board-panel main-board-panel">',
        '<header class="panel-heading">',
          '<div><span class="panel-kicker">目标海域</span><h2>敌方海域</h2></div>',
          '<div class="board-summary">剩余舰船 <strong>', String(enemyRemaining), ' / ', String(SHIP_DEFS.length), '</strong> · 已攻击 <strong>', String(state.stats.playerShots), '</strong></div>',
        '</header>',
        '<div class="board-wrap">', buildBoard(state.enemyBoard, "enemy", state.phase === "battle" && state.currentTurn === "player", state.phase === "result", false), '</div>',
      '</section>',
      '<aside class="side-rail battle-rail">',
        '<section class="rail-panel fleet-panel">',
          '<header class="rail-heading"><h2>己方舰队</h2><span class="board-summary">', String(SHIP_DEFS.length - state.stats.aiSunk), ' 艘在役</span></header>',
          '<div class="fleet-list">', renderFleetStatus(), '</div>',
        '</section>',
        '<section class="rail-panel mini-board-panel">',
          '<header class="rail-heading"><h2>己方海域</h2><span class="board-summary">AI ', accuracy(state.stats.aiHits, state.stats.aiShots), '</span></header>',
          '<div class="mini-board">', buildBoard(state.playerBoard, "player", false, true, true), '</div>',
        '</section>',
        '<section class="rail-panel battle-log">',
          '<header class="rail-heading"><h2>战报</h2><span class="board-summary">命中率 ', accuracy(state.stats.playerHits, state.stats.playerShots), '</span></header>',
          '<div class="log-list" aria-label="战斗记录">', renderLog(), '</div>',
        '</section>',
      '</aside>',
    '</section>',
  ].join("");
}

function renderShipDock() {
  return SHIP_DEFS.map(function shipButton(shipDef) {
    const placedShip = getPlacedShip(state.playerBoard, shipDef.id);
    const selected = state.selectedShipId === shipDef.id;
    const coordinates = placedShip
      ? placedShip.cells.map(function cellLabel(cell) {
        return formatCoord(cell.x, cell.y);
      }).join(" ")
      : String(shipDef.length) + " 格";
    const accessibleLabel = placedShip
      ? shipDef.name + "，已部署，拖动可调整"
      : shipDef.name + "，" + String(shipDef.length) + "格，拖动到棋盘或点击后选择坐标";
    return [
      '<button class="ship-option ', placedShip ? "placed" : "", '" type="button" data-ship-id="', shipDef.id, '" data-focus-key="ship:', shipDef.id, '" aria-pressed="', String(selected), '" aria-label="', accessibleLabel, '" title="拖动', shipDef.name, '到棋盘，或点击后选择坐标">',
        '<span><span class="ship-name">', shipDef.name, '</span><span class="ship-meta">', coordinates, '</span></span>',
        '<span class="ship-shape" aria-hidden="true">', Array.from({ length: shipDef.length }, function segment() {
          return "<span></span>";
        }).join(""), '</span>',
      '</button>',
    ].join("");
  }).join("");
}

function renderFleetStatus() {
  return SHIP_DEFS.map(function fleetRow(shipDef) {
    const ship = getPlacedShip(state.playerBoard, shipDef.id);
    const hitKeys = new Set(ship.hits.map(function hitKey(hit) {
      return coordKey(hit.x, hit.y);
    }));
    const sunk = ship.hits.length === ship.length;
    const segments = ship.cells.map(function healthSegment(cell) {
      return '<span class="' + (hitKeys.has(coordKey(cell.x, cell.y)) ? "hit" : "") + '"></span>';
    }).join("");
    return [
      '<div class="fleet-row ', sunk ? "sunk" : "", '">',
        '<span>', shipDef.name, '</span>',
        '<span class="health-segments" aria-hidden="true">', segments, '</span>',
        '<span class="fleet-count">', String(shipDef.length - ship.hits.length), '/', String(shipDef.length), '</span>',
      '</div>',
    ].join("");
  }).join("");
}

function renderLog() {
  if (!state.log.length) {
    return '<div class="log-entry"><span class="log-time">00:00</span><span class="log-actor">系统</span><span class="log-result">等待首轮攻击</span></div>';
  }
  return state.log.map(function logEntry(entry) {
    const typeClass = entry.result.includes("击沉") || entry.result.includes("胜利") ? "sunk" : entry.result === "命中" ? "hit" : "";
    const detail = entry.coord === "—" ? entry.result + (entry.shipName ? " · " + entry.shipName : "") : "攻击 " + entry.coord + "　" + entry.result + (entry.shipName ? " · " + entry.shipName : "");
    return [
      '<div class="log-entry ', typeClass, '">',
        '<span class="log-time">', formatDuration(entry.at), '</span>',
        '<span class="log-actor">', entry.actor, '</span>',
        '<span class="log-result">', detail, '</span>',
      '</div>',
    ].join("");
  }).join("");
}

function buildBoard(board, type, interactive, revealShips, compact) {
  const cursor = state.keyboardCursor[type];
  const boardName = type === "enemy" ? "敌方海域" : "己方海域";
  const cells = ['<div class="board-grid" role="grid" aria-label="', boardName, ' 10 乘 10 棋盘">'];
  cells.push('<span class="axis-cell" aria-hidden="true"></span>');
  LETTERS.forEach(function columnLabel(letter) {
    cells.push('<span class="axis-cell" role="columnheader">', letter, '</span>');
  });

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    cells.push('<span class="axis-cell" role="rowheader">', String(y + 1), '</span>');
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const ship = board.ships.find(function shipAtCell(candidate) {
        return candidate.cells.some(function matchesCell(cell) {
          return cell.x === x && cell.y === y;
        });
      });
      const shot = getShotAt(board, x, y);
      const classes = ["grid-cell"];
      if (ship && revealShips) classes.push("ship");
      if (shot) classes.push(shot.result);
      if (type === "player" && state.phase === "setup" && state.preview && state.preview.cells.some(function inPreview(cell) {
        return cell.x === x && cell.y === y;
      })) {
        classes.push(state.preview.valid ? "preview" : "invalid");
      }
      const flashKey = type + ":" + coordKey(x, y);
      if (state.flashCells.has(flashKey)) classes.push("flash");

      const available = interactive && !(type === "enemy" && shot);
      const stateLabel = shot
        ? resultLabel(shot.result)
        : ship && revealShips
          ? "有" + ship.name
          : "未攻击";
      const label = boardName + " " + formatCoord(x, y) + "，" + stateLabel;
      if (available) {
        const tabIndex = cursor.x === x && cursor.y === y ? "0" : "-1";
        cells.push(
          '<button class="', classes.join(" "), '" type="button" role="gridcell" data-cell-type="', type,
          '" data-x="', String(x), '" data-y="', String(y), '" data-focus-key="cell:', type, ':', String(x), ':', String(y),
          '" data-flash-key="', flashKey, '" tabindex="', tabIndex, '" aria-label="', label, '"></button>'
        );
      } else {
        cells.push(
          '<div class="', classes.join(" "), '" role="gridcell" data-flash-key="', flashKey, '" aria-label="', label, '"></div>'
        );
      }
    }
  }
  cells.push("</div>");
  return cells.join("");
}

function renderModal() {
  if (!state.modal) {
    modalRoot.innerHTML = "";
    gameRoot.removeAttribute("inert");
    document.body.style.overflow = "";
    return;
  }

  gameRoot.setAttribute("inert", "");
  document.body.style.overflow = "hidden";
  if (state.modal === "rules") modalRoot.innerHTML = renderRulesModal();
  if (state.modal === "restart") modalRoot.innerHTML = renderRestartModal();
  if (state.modal === "result") modalRoot.innerHTML = renderResultModal();

  if (state.modalNeedsFocus) {
    state.modalNeedsFocus = false;
    window.requestAnimationFrame(function focusModal() {
      const target = modalRoot.querySelector("[data-autofocus]");
      if (target) target.focus();
    });
  }
}

function renderRulesModal() {
  return [
    '<div class="modal-backdrop" data-modal-backdrop="true">',
      '<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="rules-title">',
        '<h2 id="rules-title">作战规则</h2>',
        '<ul class="rules-list">',
          '<li><strong>01</strong><span>舰船长度依次为 5、4、3、3、2，只能横向或纵向部署，不可重叠。</span></li>',
          '<li><strong>02</strong><span>每回合攻击一个敌方坐标。圆环代表未命中，红点代表命中，黄色叉号代表击沉。</span></li>',
          '<li><strong>03</strong><span>普通与困难 AI 会追踪命中位置；困难 AI 还会根据剩余舰船计算高概率区域。</span></li>',
          '<li><strong>04</strong><span>布阵时可拖动舰船或点击坐标，已部署舰船也能直接拖动；键盘按 R 旋转舰船。</span></li>',
        '</ul>',
        '<div class="modal-actions"><button class="primary-button" type="button" data-action="close-modal" data-autofocus>知道了</button></div>',
      '</section>',
    '</div>',
  ].join("");
}

function renderRestartModal() {
  return [
    '<div class="modal-backdrop" data-modal-backdrop="true">',
      '<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="restart-title" aria-describedby="restart-description">',
        '<h2 id="restart-title">重新开始？</h2>',
        '<p id="restart-description">当前战局不会保留，你将返回布阵阶段。</p>',
        '<div class="modal-actions">',
          '<button class="secondary-button" type="button" data-action="close-modal" data-autofocus>继续本局</button>',
          '<button class="primary-button" type="button" data-action="confirm-restart">返回布阵</button>',
        '</div>',
      '</section>',
    '</div>',
  ].join("");
}

function renderResultModal() {
  const playerWon = state.stats.playerSunk === SHIP_DEFS.length;
  return [
    '<div class="modal-backdrop">',
      '<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-describedby="result-description">',
        '<div class="result-heading">',
          '<span class="result-mark ', playerWon ? "" : "loss", '" aria-hidden="true">', playerWon ? "✓" : "×", '</span>',
          '<div><span class="panel-kicker">作战报告</span><h2 id="result-title">', playerWon ? "胜利" : "失败", '</h2></div>',
        '</div>',
        '<p id="result-description">', playerWon ? "敌方舰队已全部沉没，海域控制权归你。" : "己方舰队已失去作战能力，可以沿用布阵再战。", '</p>',
        '<div class="result-stats">',
          resultMetric("对局时长", formatDuration(state.stats.elapsedMs)),
          resultMetric("出手回合", String(state.stats.turns)),
          resultMetric("玩家命中率", accuracy(state.stats.playerHits, state.stats.playerShots)),
          resultMetric("击沉舰船", String(state.stats.playerSunk) + " / " + String(SHIP_DEFS.length)),
        '</div>',
        '<div class="modal-actions">',
          '<button class="secondary-button" type="button" data-action="reposition">重新布阵</button>',
          '<button class="primary-button" type="button" data-action="rematch" data-autofocus>沿用布阵再战</button>',
        '</div>',
      '</section>',
    '</div>',
  ].join("");
}

function resultMetric(label, value) {
  return '<div class="result-metric"><span>' + label + '</span><strong>' + value + '</strong></div>';
}

function handleAction(action) {
  if (action === "toggle-sound") toggleSound();
  if (action === "open-rules") openModal("rules");
  if (action === "request-restart") {
    if (state.phase === "battle") openModal("restart");
    else resetToSetup();
  }
  if (action === "rotate") rotatePlacement();
  if (action === "randomize") randomizePlayer();
  if (action === "reset-placement") resetPlayerPlacement();
  if (action === "start-battle") startBattle();
  if (action === "close-modal") closeModal(true);
  if (action === "confirm-restart") {
    state.modal = null;
    resetToSetup();
  }
  if (action === "rematch") rematchWithSameLayout();
  if (action === "reposition") {
    state.modal = null;
    resetToSetup();
  }
}

function moveGridFocus(cell, key) {
  const type = cell.dataset.cellType;
  let x = Number(cell.dataset.x);
  let y = Number(cell.dataset.y);
  if (key === "ArrowLeft") x -= 1;
  if (key === "ArrowRight") x += 1;
  if (key === "ArrowUp") y -= 1;
  if (key === "ArrowDown") y += 1;
  if (key === "Home") x = 0;
  if (key === "End") x = BOARD_SIZE - 1;
  x = Math.max(0, Math.min(BOARD_SIZE - 1, x));
  y = Math.max(0, Math.min(BOARD_SIZE - 1, y));

  const next = document.querySelector('[data-cell-type="' + type + '"][data-x="' + x + '"][data-y="' + y + '"]');
  if (!next) return;
  state.keyboardCursor[type] = { x: x, y: y };
  cell.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
}

document.addEventListener("pointerdown", function unlockAudio() {
  if (state.soundEnabled) ensureAudioContext();
}, { once: true });

document.addEventListener("pointerdown", function prepareShipDrag(event) {
  if (activeShipDrag) return;
  activeShipDrag = createShipDrag(event);
});

document.addEventListener("pointermove", function moveShipDrag(event) {
  const drag = activeShipDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.dragging) {
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance < SHIP_DRAG_THRESHOLD) return;
    beginShipDrag(drag, event);
  }
  event.preventDefault();
  updateShipDrag(drag, event);
}, { passive: false });

document.addEventListener("pointerup", function dropShip(event) {
  const drag = activeShipDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  activeShipDrag = null;
  if (!drag.dragging) return;
  event.preventDefault();
  updateShipDrag(drag, event);
  suppressSyntheticDragClick();
  finishShipDrag(drag, false);
});

document.addEventListener("pointercancel", function cancelShipDrag(event) {
  const drag = activeShipDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  activeShipDrag = null;
  if (!drag.dragging) return;
  suppressSyntheticDragClick();
  finishShipDrag(drag, true);
});

document.addEventListener("click", function handleClick(event) {
  if (suppressNextClick) {
    suppressNextClick = false;
    event.preventDefault();
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    handleAction(actionTarget.dataset.action);
    return;
  }

  const shipTarget = event.target.closest("[data-ship-id]");
  if (shipTarget) {
    selectShip(shipTarget.dataset.shipId);
    return;
  }

  const cell = event.target.closest("[data-cell-type]");
  if (!cell) return;
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  state.keyboardCursor[cell.dataset.cellType] = { x: x, y: y };
  if (cell.dataset.cellType === "player") handlePlayerCell(x, y);
  if (cell.dataset.cellType === "enemy") attackEnemy(x, y);
});

difficultySelect.addEventListener("change", function changeDifficulty(event) {
  state.difficulty = event.target.value;
  window.localStorage.setItem("battleship.difficulty", state.difficulty);
  setMessage("AI 难度已设为" + difficultyLabel(state.difficulty) + "。");
  updateHeader();
});

themeSelect.addEventListener("change", function changeTheme(event) {
  themePreference = event.target.value;
  window.localStorage.setItem("battleship.theme", themePreference);
  applyTheme();
  const labels = { auto: "跟随系统", day: "白天", night: "夜晚" };
  setMessage("显示主题已切换为" + labels[themePreference] + "。");
  statusMessage.textContent = state.message;
});

systemThemeQuery.addEventListener("change", function followSystemTheme() {
  if (themePreference === "auto") applyTheme();
});

document.addEventListener("keydown", function handleKeyboard(event) {
  if (activeShipDrag && activeShipDrag.dragging && event.key === "Escape") {
    event.preventDefault();
    const drag = activeShipDrag;
    activeShipDrag = null;
    suppressSyntheticDragClick();
    finishShipDrag(drag, true);
    return;
  }

  if (state.modal) {
    if (event.key === "Escape" && state.modal !== "result") {
      event.preventDefault();
      closeModal(true);
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(modalRoot.querySelectorAll('button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }

  const cell = event.target.closest && event.target.closest("[data-cell-type]");
  if (cell && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    moveGridFocus(cell, event.key);
    return;
  }

  const isFormControl = event.target.matches && event.target.matches("select, input, textarea");
  if (!isFormControl && state.phase === "setup" && event.key.toLowerCase() === "r") {
    event.preventDefault();
    rotatePlacement();
  }
});

modalRoot.addEventListener("click", function closeFromBackdrop(event) {
  if (event.target.dataset.modalBackdrop === "true" && state.modal !== "result") {
    closeModal(true);
  }
});

window.render_game_to_text = function renderGameToText() {
  return JSON.stringify({
    seed: seed,
    phase: state.phase,
    currentTurn: state.currentTurn,
    difficulty: state.difficulty,
    themePreference: themePreference,
    resolvedTheme: resolvedTheme(),
    elapsed: formatDuration(elapsedMs()),
    selectedShipId: state.selectedShipId,
    placementOrientation: state.orientation,
    playerShips: state.playerBoard.ships.map(function serializeShip(ship) {
      return {
        id: ship.id,
        cells: ship.cells.map(function serializeCell(cell) {
          return formatCoord(cell.x, cell.y);
        }),
        hits: ship.hits.map(function serializeHit(hit) {
          return formatCoord(hit.x, hit.y);
        }),
      };
    }),
    enemyShots: state.enemyBoard.shots.map(function serializeShot(shot) {
      return { coord: formatCoord(shot.x, shot.y), result: shot.result };
    }),
    message: state.message,
  });
};

if (new URLSearchParams(window.location.search).get("test") === "1") {
  window.__BATTLESHIP_TEST__ = {
    finish: function finishForTest(winner) {
      if (winner === "player") state.stats.playerSunk = SHIP_DEFS.length;
      if (winner === "ai") state.stats.aiSunk = SHIP_DEFS.length;
      completeGame(winner);
    },
  };
}

applyTheme();
render();
