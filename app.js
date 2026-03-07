(function () {
  const BOARD_SIZE = 10;
  const LETTERS = "ABCDEFGHIJ".split("");
  const SHIP_DEFS = [
    { id: "carrier", name: "航空母舰", length: 5 },
    { id: "battleship", name: "战列舰", length: 4 },
    { id: "cruiser", name: "巡洋舰", length: 3 },
    { id: "submarine", name: "潜艇", length: 3 },
    { id: "destroyer", name: "驱逐舰", length: 2 },
  ];

  const template = document.getElementById("app-template");
  const app = document.getElementById("app");
  app.appendChild(template.content.cloneNode(true));

  const refs = {
    phaseLabel: document.querySelector('[data-role="phase-label"]'),
    statusMessage: document.querySelector('[data-role="status-message"]'),
    difficultySelect: document.querySelector('[data-role="difficulty-select"]'),
    setupPanel: document.querySelector('[data-role="setup-panel"]'),
    setupSummary: document.querySelector('[data-role="setup-summary"]'),
    shipList: document.querySelector('[data-role="ship-list"]'),
    battleLog: document.querySelector('[data-role="battle-log"]'),
    statsGrid: document.querySelector('[data-role="stats-grid"]'),
    enemyBoard: document.querySelector('[data-role="enemy-board"]'),
    playerBoard: document.querySelector('[data-role="player-board"]'),
    tutorialModal: document.querySelector('[data-role="tutorial-modal"]'),
    resultModal: document.querySelector('[data-role="result-modal"]'),
    resultTitle: document.querySelector('[data-role="result-title"]'),
    resultStats: document.querySelector('[data-role="result-stats"]'),
  };

  const state = createInitialState();
  let schedulerHandle = null;
  let audioContext = null;

  const SOUND_PRESETS = {
    miss: [
      { type: "triangle", frequency: 220, duration: 0.08, gain: 0.045 },
      { type: "sine", frequency: 164, duration: 0.16, gain: 0.04, delay: 0.06 },
    ],
    hit: [
      { type: "square", frequency: 360, duration: 0.06, gain: 0.05 },
      { type: "square", frequency: 480, duration: 0.08, gain: 0.045, delay: 0.05 },
    ],
    sunk: [
      { type: "sawtooth", frequency: 240, duration: 0.07, gain: 0.045 },
      { type: "square", frequency: 360, duration: 0.08, gain: 0.05, delay: 0.05 },
      { type: "triangle", frequency: 160, duration: 0.24, gain: 0.055, delay: 0.11 },
    ],
  };

  function createBoard() {
    return {
      ships: [],
      shots: [],
    };
  }

  function createInitialState() {
    return {
      phase: "setup",
      difficulty: "medium",
      currentTurn: "player",
      placementOrientation: "horizontal",
      selectedShipId: SHIP_DEFS[0].id,
      preview: null,
      allowAdjacent: true,
      message: "选择舰船并完成布阵。",
      playerBoard: createBoard(),
      enemyBoard: createBoard(),
      log: [
        {
          id: crypto.randomUUID(),
          actor: "系统",
          text: "海战开始前，请先部署你的舰队。",
        },
      ],
      stats: {
        turns: 0,
        playerShots: 0,
        playerHits: 0,
        aiShots: 0,
        aiHits: 0,
        playerSunk: 0,
        aiSunk: 0,
        startedAt: null,
        endedAt: null,
      },
      tutorialOpen: false,
      resultOpen: false,
      timerMs: 0,
      scheduledEvents: [],
      aiMemory: {
        huntQueue: [],
        hitsToResolve: [],
        parityOffset: 0,
      },
      flashCells: [],
    };
  }

  function ensureAudioContext() {
    if (audioContext) {
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      return audioContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }
    audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function playSound(name) {
    const context = ensureAudioContext();
    const preset = SOUND_PRESETS[name];
    if (!context || !preset) {
      return;
    }
    const startAt = context.currentTime + 0.01;
    preset.forEach((tone) => {
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

  function resetState(fullReset = true) {
    const difficulty = state.difficulty;
    Object.assign(state, createInitialState());
    state.difficulty = difficulty;
    state.tutorialOpen = false;
    randomizeBoard(state.enemyBoard);
    render();
  }

  function cloneCoord(coord) {
    return { x: coord.x, y: coord.y };
  }

  function coordsEqual(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function coordKey(x, y) {
    return `${x},${y}`;
  }

  function formatCoord(x, y) {
    return `${LETTERS[x]}${y + 1}`;
  }

  function getShipCells(startX, startY, length, orientation) {
    return Array.from({ length }, (_, index) => ({
      x: orientation === "horizontal" ? startX + index : startX,
      y: orientation === "vertical" ? startY + index : startY,
    }));
  }

  function isWithinBounds(cells) {
    return cells.every((cell) => cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE);
  }

  function canPlaceShip(board, shipDef, x, y, orientation, ignoreShipId = null) {
    const cells = getShipCells(x, y, shipDef.length, orientation);
    if (!isWithinBounds(cells)) {
      return { ok: false, cells };
    }
    const occupied = new Set();
    board.ships.forEach((ship) => {
      if (ship.id === ignoreShipId) {
        return;
      }
      ship.cells.forEach((cell) => occupied.add(coordKey(cell.x, cell.y)));
    });
    const overlaps = cells.some((cell) => occupied.has(coordKey(cell.x, cell.y)));
    return { ok: !overlaps, cells };
  }

  function placeShip(board, shipId, x, y, orientation) {
    const shipDef = SHIP_DEFS.find((ship) => ship.id === shipId);
    const candidate = canPlaceShip(board, shipDef, x, y, orientation);
    if (!candidate.ok) {
      return false;
    }
    board.ships = board.ships.filter((ship) => ship.id !== shipId);
    board.ships.push({
      id: shipId,
      name: shipDef.name,
      length: shipDef.length,
      orientation,
      cells: candidate.cells,
      hits: [],
    });
    return true;
  }

  function removeShip(board, shipId) {
    const target = getPlacedShip(board, shipId);
    if (!target) {
      return null;
    }
    board.ships = board.ships.filter((ship) => ship.id !== shipId);
    return target;
  }

  function randomizeBoard(board) {
    board.ships = [];
    board.shots = [];
    for (const shipDef of SHIP_DEFS) {
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 300) {
        attempts += 1;
        const orientation = Math.random() > 0.5 ? "horizontal" : "vertical";
        const x = Math.floor(Math.random() * BOARD_SIZE);
        const y = Math.floor(Math.random() * BOARD_SIZE);
        placed = placeShip(board, shipDef.id, x, y, orientation);
      }
    }
  }

  function getPlacedShip(board, shipId) {
    return board.ships.find((ship) => ship.id === shipId);
  }

  function isBoardReady(board) {
    return SHIP_DEFS.every((ship) => getPlacedShip(board, ship.id));
  }

  function getUnplacedShipDefs(board) {
    return SHIP_DEFS.filter((shipDef) => !getPlacedShip(board, shipDef.id));
  }

  function getNextUnplacedShipId(board) {
    return getUnplacedShipDefs(board)[0]?.id || null;
  }

  function ensureSelectableShip() {
    const selectedPlaced = state.selectedShipId && getPlacedShip(state.playerBoard, state.selectedShipId);
    if (!state.selectedShipId || selectedPlaced) {
      state.selectedShipId = getNextUnplacedShipId(state.playerBoard);
    }
  }

  function clearPreview(shouldRender = true) {
    if (!state.preview) {
      return;
    }
    state.preview = null;
    if (shouldRender) {
      render();
    }
  }

  function getShotAt(board, x, y) {
    return board.shots.find((shot) => shot.x === x && shot.y === y) || null;
  }

  function resolveShot(board, x, y) {
    if (getShotAt(board, x, y)) {
      return { valid: false, reason: "duplicate" };
    }
    const ship = board.ships.find((candidate) => candidate.cells.some((cell) => cell.x === x && cell.y === y));
    const shot = {
      x,
      y,
      result: "miss",
      shipId: ship ? ship.id : null,
      timestamp: state.timerMs,
    };
    if (ship) {
      ship.hits.push({ x, y });
      shot.result = ship.hits.length === ship.length ? "sunk" : "hit";
    }
    board.shots.push(shot);
    return { valid: true, shot, ship };
  }

  function allShipsSunk(board) {
    return board.ships.every((ship) => ship.hits.length === ship.length);
  }

  function getShotSummary(result) {
    if (result === "miss") return "未命中";
    if (result === "hit") return "命中";
    return "击沉";
  }

  function pushLog(actor, text) {
    state.log.unshift({
      id: crypto.randomUUID(),
      actor,
      text,
    });
    state.log = state.log.slice(0, 12);
  }

  function schedule(delayMs, callback) {
    state.scheduledEvents.push({
      id: crypto.randomUUID(),
      dueAt: state.timerMs + delayMs,
      callback,
    });
    armScheduler();
  }

  function markFlash(boardId, x, y) {
    state.flashCells.push({
      boardId,
      x,
      y,
      expiresAt: state.timerMs + 650,
    });
    armScheduler();
  }

  function update(deltaMs) {
    state.timerMs += deltaMs;
    state.flashCells = state.flashCells.filter((item) => item.expiresAt > state.timerMs);
    const due = state.scheduledEvents.filter((event) => event.dueAt <= state.timerMs);
    state.scheduledEvents = state.scheduledEvents.filter((event) => event.dueAt > state.timerMs);
    due.forEach((event) => event.callback());
  }

  function armScheduler() {
    if (schedulerHandle !== null) {
      clearTimeout(schedulerHandle);
      schedulerHandle = null;
    }
    const candidates = [];
    if (state.scheduledEvents.length) {
      candidates.push(Math.min(...state.scheduledEvents.map((event) => event.dueAt)));
    }
    if (state.flashCells.length) {
      candidates.push(Math.min(...state.flashCells.map((item) => item.expiresAt)));
    }
    if (!candidates.length) {
      return;
    }
    const nextDueAt = Math.min(...candidates);
    const delay = Math.max(0, nextDueAt - state.timerMs);
    schedulerHandle = window.setTimeout(() => {
      schedulerHandle = null;
      update(delay);
      render();
      armScheduler();
    }, delay);
  }

  function setMessage(message) {
    state.message = message;
  }

  function rotatePlacement() {
    state.placementOrientation = state.placementOrientation === "horizontal" ? "vertical" : "horizontal";
    setMessage(`当前方向：${state.placementOrientation === "horizontal" ? "横向" : "纵向"}`);
    render();
  }

  function randomizePlayerBoard() {
    randomizeBoard(state.playerBoard);
    state.selectedShipId = null;
    setMessage("已为你完成随机布阵，可以直接开战。");
    pushLog("系统", "玩家舰队已随机部署。");
    render();
  }

  function resetPlayerBoard() {
    state.phase = "setup";
    state.currentTurn = "player";
    state.playerBoard = createBoard();
    state.enemyBoard = createBoard();
    randomizeBoard(state.enemyBoard);
    state.selectedShipId = SHIP_DEFS[0].id;
    state.preview = null;
    state.log = [
      {
        id: crypto.randomUUID(),
        actor: "系统",
        text: "已重置战局，请重新布阵。",
      },
    ];
    state.stats = {
      turns: 0,
      playerShots: 0,
      playerHits: 0,
      aiShots: 0,
      aiHits: 0,
      playerSunk: 0,
      aiSunk: 0,
      startedAt: null,
      endedAt: null,
    };
    state.aiMemory = { huntQueue: [], hitsToResolve: [], parityOffset: Math.floor(Math.random() * 2) };
    state.resultOpen = false;
    setMessage("请重新部署你的舰队。");
    render();
  }

  function startBattle() {
    if (!isBoardReady(state.playerBoard)) {
      const nextShip = getUnplacedShipDefs(state.playerBoard)[0];
      setMessage(nextShip ? `还有舰船未放置：${nextShip.name}` : "还有舰船未放置完成。");
      render();
      return;
    }
    state.phase = "battle";
    state.currentTurn = "player";
    state.stats.startedAt = state.timerMs;
    state.tutorialOpen = false;
    setMessage("你的回合：点击敌方海域发起攻击。");
    pushLog("系统", `战斗开始，AI 难度为${difficultyLabel(state.difficulty)}。`);
    render();
  }

  function difficultyLabel(value) {
    return value === "easy" ? "简单" : value === "medium" ? "普通" : "困难";
  }

  function completeGame(winner) {
    state.phase = "result";
    state.resultOpen = true;
    state.stats.endedAt = state.timerMs;
    state.currentTurn = null;
    const isPlayerWin = winner === "player";
    refs.resultTitle.textContent = isPlayerWin ? "胜利" : "失败";
    setMessage(isPlayerWin ? "敌方舰队全灭。" : "你的舰队已被击沉。");
    pushLog("系统", isPlayerWin ? "作战结束，你赢下了本场海战。" : "作战结束，AI 取得胜利。");
    render();
  }

  function attackEnemy(x, y) {
    if (state.phase !== "battle" || state.currentTurn !== "player") {
      return;
    }
    const outcome = resolveShot(state.enemyBoard, x, y);
    if (!outcome.valid) {
      setMessage("这个坐标已经攻击过了。");
      render();
      return;
    }
    state.stats.turns += 1;
    state.stats.playerShots += 1;
    if (outcome.shot.result !== "miss") {
      state.stats.playerHits += 1;
    }
    if (outcome.shot.result === "sunk") {
      state.stats.playerSunk += 1;
    }
    markFlash("enemy", x, y);
    playSound(outcome.shot.result);
    pushLog("玩家", `${formatCoord(x, y)} ${getShotSummary(outcome.shot.result)}`);
    setMessage(`你的攻击结果：${getShotSummary(outcome.shot.result)}`);
    if (allShipsSunk(state.enemyBoard)) {
      completeGame("player");
      return;
    }
    state.currentTurn = "ai";
    schedule(650, aiTurn);
    render();
  }

  function aiTurn() {
    if (state.phase !== "battle") {
      return;
    }
    const target = chooseAiTarget();
    const outcome = resolveShot(state.playerBoard, target.x, target.y);
    if (!outcome.valid) {
      schedule(10, aiTurn);
      return;
    }
    state.stats.aiShots += 1;
    if (outcome.shot.result !== "miss") {
      state.stats.aiHits += 1;
    }
    if (outcome.shot.result === "sunk") {
      state.stats.aiSunk += 1;
    }
    rememberAiShot(outcome.shot);
    markFlash("player", target.x, target.y);
    playSound(outcome.shot.result);
    pushLog("AI", `${formatCoord(target.x, target.y)} ${getShotSummary(outcome.shot.result)}`);
    setMessage(`AI 攻击 ${formatCoord(target.x, target.y)}：${getShotSummary(outcome.shot.result)}`);
    if (allShipsSunk(state.playerBoard)) {
      completeGame("ai");
      return;
    }
    state.currentTurn = "player";
    setMessage("你的回合：继续攻击敌方海域。");
    render();
  }

  function rememberAiShot(shot) {
    const key = coordKey(shot.x, shot.y);
    state.aiMemory.huntQueue = state.aiMemory.huntQueue.filter((coord) => coordKey(coord.x, coord.y) !== key);
    if (shot.result === "hit") {
      state.aiMemory.hitsToResolve.push({ x: shot.x, y: shot.y });
      getNeighborCoords(shot.x, shot.y).forEach((coord) => {
        const seen = state.playerBoard.shots.some((entry) => coordsEqual(entry, coord));
        const queued = state.aiMemory.huntQueue.some((entry) => coordsEqual(entry, coord));
        if (!seen && !queued) {
          state.aiMemory.huntQueue.unshift(coord);
        }
      });
    }
    if (shot.result === "sunk") {
      const sunkShip = state.playerBoard.ships.find((ship) => ship.id === shot.shipId);
      const sunkKeys = new Set(sunkShip.cells.map((cell) => coordKey(cell.x, cell.y)));
      state.aiMemory.hitsToResolve = state.aiMemory.hitsToResolve.filter((coord) => !sunkKeys.has(coordKey(coord.x, coord.y)));
      state.aiMemory.huntQueue = state.aiMemory.huntQueue.filter((coord) => !sunkKeys.has(coordKey(coord.x, coord.y)));
    }
  }

  function getNeighborCoords(x, y) {
    return [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ].filter((coord) => coord.x >= 0 && coord.x < BOARD_SIZE && coord.y >= 0 && coord.y < BOARD_SIZE);
  }

  function chooseAiTarget() {
    const taken = new Set(state.playerBoard.shots.map((shot) => coordKey(shot.x, shot.y)));
    const available = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        if (!taken.has(coordKey(x, y))) {
          available.push({ x, y });
        }
      }
    }
    if (state.difficulty === "easy") {
      return available[Math.floor(Math.random() * available.length)];
    }
    const queued = state.aiMemory.huntQueue.find((coord) => !taken.has(coordKey(coord.x, coord.y)));
    if (queued) {
      return cloneCoord(queued);
    }
    if (state.difficulty === "medium") {
      return available[Math.floor(Math.random() * available.length)];
    }
    return chooseProbabilityTarget(available, taken);
  }

  function chooseProbabilityTarget(available, taken) {
    const remainingShips = SHIP_DEFS.filter((shipDef) => {
      const boardShip = state.playerBoard.ships.find((ship) => ship.id === shipDef.id);
      return !boardShip || boardShip.hits.length < boardShip.length;
    });
    const scores = new Map();
    available.forEach((coord) => {
      scores.set(coordKey(coord.x, coord.y), 0);
    });

    remainingShips.forEach((shipDef) => {
      ["horizontal", "vertical"].forEach((orientation) => {
        for (let y = 0; y < BOARD_SIZE; y += 1) {
          for (let x = 0; x < BOARD_SIZE; x += 1) {
            const cells = getShipCells(x, y, shipDef.length, orientation);
            if (!isWithinBounds(cells)) {
              continue;
            }
            if (cells.some((cell) => {
              const shot = getShotAt(state.playerBoard, cell.x, cell.y);
              return shot && shot.result === "miss";
            })) {
              continue;
            }
            const hitCells = state.playerBoard.shots.filter((shot) => shot.result !== "miss").map((shot) => coordKey(shot.x, shot.y));
            const placementKeys = cells.map((cell) => coordKey(cell.x, cell.y));
            if (hitCells.some((key) => !placementKeys.includes(key) && state.aiMemory.hitsToResolve.some((coord) => coordKey(coord.x, coord.y) === key))) {
              continue;
            }
            cells.forEach((cell) => {
              const key = coordKey(cell.x, cell.y);
              if (!taken.has(key)) {
                scores.set(key, (scores.get(key) || 0) + 1);
              }
            });
          }
        }
      });
    });

    let best = available[0];
    let bestScore = -1;
    available.forEach((coord) => {
      const key = coordKey(coord.x, coord.y);
      const parityBonus = (coord.x + coord.y) % 2 === state.aiMemory.parityOffset ? 0.15 : 0;
      const score = (scores.get(key) || 0) + parityBonus;
      if (score > bestScore) {
        best = coord;
        bestScore = score;
      }
    });
    return cloneCoord(best);
  }

  function getCellState(board, x, y, revealShips) {
    const ship = board.ships.find((candidate) => candidate.cells.some((cell) => cell.x === x && cell.y === y));
    const shot = getShotAt(board, x, y);
    const classes = ["grid-cell"];
    if (ship && revealShips) classes.push("ship");
    if (shot) classes.push(shot.result);
    const boardId = revealShips ? "player" : "enemy";
    const exists = state.flashCells.some((item) => item.boardId === boardId && item.x === x && item.y === y);
    if (exists) classes.push("flash");
    return {
      ship,
      shot,
      classes,
    };
  }

  function buildBoard(board, options) {
    const { type, revealShips, clickHandler } = options;
    const element = document.createElement("div");
    element.className = "grid-board";

    element.appendChild(axisCell(""));
    LETTERS.forEach((letter) => element.appendChild(axisCell(letter)));
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      element.appendChild(axisCell(String(y + 1)));
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const cellState = getCellState(board, x, y, revealShips);
        const button = document.createElement("button");
        button.type = "button";
        button.className = cellState.classes.join(" ");
        button.setAttribute("aria-label", `${type}-${formatCoord(x, y)}`);
        if (clickHandler) {
          button.classList.add("clickable");
          button.addEventListener("click", () => clickHandler(x, y));
        }
        if (type === "player" && state.phase === "setup" && state.preview) {
          const isPreview = state.preview.cells.some((coord) => coord.x === x && coord.y === y);
          if (isPreview) {
            button.classList.add(state.preview.valid ? "preview" : "invalid");
          }
        }
        if (state.phase === "battle" && type === "enemy" && getShotAt(board, x, y)) {
          button.disabled = true;
        }
        element.appendChild(button);
      }
    }
    return element;
  }

  function axisCell(text) {
    const cell = document.createElement("div");
    cell.className = "axis-cell";
    cell.textContent = text;
    return cell;
  }

  function updatePreview(x, y) {
    if (state.phase !== "setup") {
      return;
    }
    const shipDef = SHIP_DEFS.find((ship) => ship.id === state.selectedShipId);
    if (!shipDef || getPlacedShip(state.playerBoard, shipDef.id)) {
      clearPreview();
      return;
    }
    const candidate = canPlaceShip(state.playerBoard, shipDef, x, y, state.placementOrientation);
    state.preview = {
      cells: candidate.cells,
      valid: candidate.ok,
    };
    render();
  }

  function handlePlayerBoardClick(x, y) {
    if (state.phase !== "setup") {
      return;
    }
    const existingShip = state.playerBoard.ships.find((ship) => ship.cells.some((cell) => cell.x === x && cell.y === y));
    if (existingShip) {
      removeShip(state.playerBoard, existingShip.id);
      state.selectedShipId = existingShip.id;
      state.preview = {
        cells: existingShip.cells,
        valid: true,
      };
      setMessage(`已撤销 ${existingShip.name}，请重新选择位置。`);
      pushLog("系统", `${existingShip.name} 已解除部署。`);
      render();
      return;
    }
    ensureSelectableShip();
    const shipDef = SHIP_DEFS.find((ship) => ship.id === state.selectedShipId);
    if (!shipDef) {
      setMessage("所有舰船都已部署完成，可以开始对战。");
      render();
      return;
    }
    if (getPlacedShip(state.playerBoard, shipDef.id)) {
      state.selectedShipId = getNextUnplacedShipId(state.playerBoard);
      const nextShip = state.selectedShipId && SHIP_DEFS.find((ship) => ship.id === state.selectedShipId);
      setMessage(nextShip ? `${shipDef.name} 已部署，请继续放置 ${nextShip.name}` : "所有舰船都已部署完成。");
      render();
      return;
    }
    const placed = placeShip(state.playerBoard, shipDef.id, x, y, state.placementOrientation);
    if (!placed) {
      setMessage("该位置无法放置舰船。");
      render();
      return;
    }
    pushLog("系统", `${shipDef.name} 已部署在 ${formatCoord(x, y)} 附近。`);
    const nextShip = getUnplacedShipDefs(state.playerBoard)[0];
    state.selectedShipId = null;
    clearPreview(false);
    setMessage(nextShip ? `${shipDef.name} 已锁定，请点击下一艘舰船继续布阵。` : "布阵完成，可以开始对战。");
    render();
  }

  function handleAction(action) {
    switch (action) {
      case "toggle-tutorial":
        state.tutorialOpen = !state.tutorialOpen;
        render();
        break;
      case "rotate-ship":
        rotatePlacement();
        break;
      case "randomize-player":
        randomizePlayerBoard();
        break;
      case "reset-player":
        resetPlayerBoard();
        break;
      case "start-battle":
        startBattle();
        break;
      case "restart-game":
        resetPlayerBoard();
        state.resultOpen = false;
        state.tutorialOpen = false;
        render();
        break;
      default:
        break;
    }
  }

  function renderShipList() {
    refs.shipList.innerHTML = "";
    SHIP_DEFS.forEach((shipDef) => {
      const placedShip = getPlacedShip(state.playerBoard, shipDef.id);
      const placed = Boolean(placedShip);
      const item = document.createElement("button");
      item.type = "button";
      item.className = ["ship-card", state.selectedShipId === shipDef.id ? "active" : "", placed ? "placed" : ""].filter(Boolean).join(" ");
      item.setAttribute("aria-pressed", state.selectedShipId === shipDef.id ? "true" : "false");
      item.addEventListener("click", () => {
        if (placed) {
          removeShip(state.playerBoard, shipDef.id);
          state.selectedShipId = shipDef.id;
          state.preview = {
            cells: placedShip.cells,
            valid: true,
          };
          setMessage(`已撤销 ${shipDef.name}，请重新放置。`);
          pushLog("系统", `${shipDef.name} 已解除部署。`);
          render();
          return;
        }
        state.selectedShipId = shipDef.id;
        clearPreview(false);
        setMessage(`已选中 ${shipDef.name}`);
        render();
      });

      const labelWrap = document.createElement("div");
      labelWrap.innerHTML = `<strong>${shipDef.name}</strong><div>${placed ? `已部署 · ${placedShip.cells.map((cell) => formatCoord(cell.x, cell.y)).join(" ")}` : `${shipDef.length} 格待部署`}</div>`;

      const shape = document.createElement("div");
      shape.className = "ship-shape";
      for (let i = 0; i < shipDef.length; i += 1) {
        const part = document.createElement("span");
        shape.appendChild(part);
      }
      item.append(labelWrap, shape);
      refs.shipList.appendChild(item);
    });
  }

  function renderSetupSummary() {
    const placedCount = state.playerBoard.ships.length;
    const totalCount = SHIP_DEFS.length;
    const nextShip = state.selectedShipId && SHIP_DEFS.find((ship) => ship.id === state.selectedShipId);
    refs.setupSummary.innerHTML = [
      `<div class="setup-pill"><span>已部署</span><strong>${placedCount} / ${totalCount}</strong></div>`,
      `<div class="setup-pill"><span>当前方向</span><strong>${state.placementOrientation === "horizontal" ? "横向" : "纵向"}</strong></div>`,
      `<div class="setup-pill"><span>当前舰船</span><strong>${nextShip ? nextShip.name : "全部完成"}</strong></div>`,
    ].join("");
  }

  function renderLog() {
    refs.battleLog.innerHTML = "";
    state.log.forEach((entry) => {
      const item = document.createElement("div");
      item.className = "log-entry";
      item.innerHTML = `<strong>${entry.actor}</strong> ${entry.text}`;
      refs.battleLog.appendChild(item);
    });
  }

  function accuracy(hits, shots) {
    if (!shots) return "0%";
    return `${Math.round((hits / shots) * 100)}%`;
  }

  function durationText() {
    if (!state.stats.startedAt) return "00:00";
    const end = state.stats.endedAt || state.timerMs;
    const totalSeconds = Math.max(0, Math.floor((end - state.stats.startedAt) / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function renderStats() {
    const metrics = [
      { label: "玩家命中率", value: accuracy(state.stats.playerHits, state.stats.playerShots) },
      { label: "AI 命中率", value: accuracy(state.stats.aiHits, state.stats.aiShots) },
      { label: "玩家击沉", value: `${state.stats.playerSunk} 艘` },
      { label: "AI 击沉", value: `${state.stats.aiSunk} 艘` },
      { label: "已用时长", value: durationText() },
      { label: "已出手回合", value: `${state.stats.turns}` },
    ];
    refs.statsGrid.innerHTML = metrics.map(metricCard).join("");
    refs.resultStats.innerHTML = [
      { label: "对局时长", value: durationText() },
      { label: "玩家命中率", value: accuracy(state.stats.playerHits, state.stats.playerShots) },
      { label: "AI 命中率", value: accuracy(state.stats.aiHits, state.stats.aiShots) },
      { label: "玩家击沉", value: `${state.stats.playerSunk} / ${SHIP_DEFS.length}` },
    ].map(metricCard).join("");
  }

  function metricCard(metric) {
    return `<div class="metric"><span>${metric.label}</span><strong>${metric.value}</strong></div>`;
  }

  function renderBoards() {
    refs.playerBoard.innerHTML = "";
    refs.enemyBoard.innerHTML = "";
    refs.playerBoard.appendChild(buildBoard(state.playerBoard, {
      type: "player",
      revealShips: true,
      clickHandler: state.phase === "setup" ? handlePlayerBoardClick : null,
    }));
    refs.enemyBoard.appendChild(buildBoard(state.enemyBoard, {
      type: "enemy",
      revealShips: state.phase === "result",
      clickHandler: state.phase === "battle" && state.currentTurn === "player" ? attackEnemy : null,
    }));
  }

  function render() {
    refs.phaseLabel.textContent =
      state.phase === "setup" ? "布阵阶段" :
      state.phase === "battle" ? (state.currentTurn === "player" ? "你的回合" : "AI 回合") :
      "结算阶段";
    refs.statusMessage.textContent = state.message;
    refs.difficultySelect.value = state.difficulty;
    refs.setupPanel.style.display = state.phase === "setup" ? "block" : "none";
    refs.tutorialModal.classList.toggle("hidden", !state.tutorialOpen);
    refs.resultModal.classList.toggle("hidden", !state.resultOpen);
    renderSetupSummary();
    renderShipList();
    renderLog();
    renderStats();
    renderBoards();
  }

  function bindEvents() {
    document.body.addEventListener("pointerdown", () => {
      ensureAudioContext();
    }, { once: true });
    document.body.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.getAttribute("data-action");
      if (action) {
        handleAction(action);
      }
    });
    refs.difficultySelect.addEventListener("change", (event) => {
      state.difficulty = event.target.value;
      setMessage(`AI 难度已切换为${difficultyLabel(state.difficulty)}。`);
      render();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "r") {
        rotatePlacement();
      }
      if (event.key.toLowerCase() === "f") {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      }
      if (event.key === "Escape" && document.fullscreenElement) {
        document.exitFullscreen?.();
      }
    });
  }

  window.render_game_to_text = function renderGameToText() {
    return JSON.stringify({
      coordinate_system: {
        origin: "top-left",
        x: "A-J left-to-right",
        y: "1-10 top-to-bottom",
      },
      phase: state.phase,
      currentTurn: state.currentTurn,
      difficulty: state.difficulty,
      placementOrientation: state.placementOrientation,
      selectedShipId: state.selectedShipId,
      playerBoard: {
        ships: state.playerBoard.ships.map((ship) => ({
          id: ship.id,
          cells: ship.cells.map((cell) => formatCoord(cell.x, cell.y)),
          hits: ship.hits.map((cell) => formatCoord(cell.x, cell.y)),
        })),
        unplacedShips: getUnplacedShipDefs(state.playerBoard).map((ship) => ship.id),
        shots: state.playerBoard.shots.map((shot) => ({
          coord: formatCoord(shot.x, shot.y),
          result: shot.result,
        })),
      },
      enemyBoard: {
        knownShots: state.enemyBoard.shots.map((shot) => ({
          coord: formatCoord(shot.x, shot.y),
          result: shot.result,
        })),
        shipsRemaining: state.enemyBoard.ships.filter((ship) => ship.hits.length < ship.length).length,
      },
      stats: {
        turns: state.stats.turns,
        playerAccuracy: accuracy(state.stats.playerHits, state.stats.playerShots),
        aiAccuracy: accuracy(state.stats.aiHits, state.stats.aiShots),
        duration: durationText(),
      },
      message: state.message,
    });
  };

  window.advanceTime = function advanceTime(ms) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const stepMs = ms / steps;
    for (let index = 0; index < steps; index += 1) {
      update(stepMs);
    }
    render();
    armScheduler();
  };

  bindEvents();
  resetState(true);
})();
