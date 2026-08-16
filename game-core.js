export const BOARD_SIZE = 10;
export const LETTERS = "ABCDEFGHIJ".split("");

export const SHIP_DEFS = [
  { id: "carrier", name: "航空母舰", length: 5 },
  { id: "battleship", name: "战列舰", length: 4 },
  { id: "cruiser", name: "巡洋舰", length: 3 },
  { id: "submarine", name: "潜艇", length: 3 },
  { id: "destroyer", name: "驱逐舰", length: 2 },
];

export function createSeededRng(seed) {
  let value = Number(seed) >>> 0;
  return function seededRandom() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBoard() {
  return {
    ships: [],
    shots: [],
  };
}

export function clonePlacementBoard(board) {
  return {
    ships: board.ships.map(function cloneShip(ship) {
      return {
        id: ship.id,
        name: ship.name,
        length: ship.length,
        orientation: ship.orientation,
        cells: ship.cells.map(cloneCoord),
        hits: [],
      };
    }),
    shots: [],
  };
}

export function cloneCoord(coord) {
  return { x: coord.x, y: coord.y };
}

export function coordKey(x, y) {
  return String(x) + "," + String(y);
}

export function formatCoord(x, y) {
  return LETTERS[x] + String(y + 1);
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return minutes + ":" + seconds;
}

export function getShipCells(startX, startY, length, orientation) {
  return Array.from({ length: length }, function buildCell(_, index) {
    return {
      x: orientation === "horizontal" ? startX + index : startX,
      y: orientation === "vertical" ? startY + index : startY,
    };
  });
}

export function isWithinBounds(cells) {
  return cells.every(function checkCell(cell) {
    return cell.x >= 0 && cell.x < BOARD_SIZE && cell.y >= 0 && cell.y < BOARD_SIZE;
  });
}

export function getPlacedShip(board, shipId) {
  return board.ships.find(function findShip(ship) {
    return ship.id === shipId;
  });
}

export function canPlaceShip(board, shipDef, x, y, orientation, ignoreShipId) {
  const cells = getShipCells(x, y, shipDef.length, orientation);
  if (!isWithinBounds(cells)) {
    return { ok: false, cells: cells };
  }

  const occupied = new Set();
  board.ships.forEach(function addOccupied(ship) {
    if (ship.id === ignoreShipId) return;
    ship.cells.forEach(function addCell(cell) {
      occupied.add(coordKey(cell.x, cell.y));
    });
  });

  const overlaps = cells.some(function hasOverlap(cell) {
    return occupied.has(coordKey(cell.x, cell.y));
  });
  return { ok: !overlaps, cells: cells };
}

export function placeShip(board, shipId, x, y, orientation) {
  const shipDef = SHIP_DEFS.find(function findDefinition(definition) {
    return definition.id === shipId;
  });
  if (!shipDef) return false;

  const candidate = canPlaceShip(board, shipDef, x, y, orientation, shipId);
  if (!candidate.ok) return false;

  board.ships = board.ships.filter(function removePrevious(ship) {
    return ship.id !== shipId;
  });
  board.ships.push({
    id: shipDef.id,
    name: shipDef.name,
    length: shipDef.length,
    orientation: orientation,
    cells: candidate.cells,
    hits: [],
  });
  return true;
}

export function removeShip(board, shipId) {
  const target = getPlacedShip(board, shipId);
  if (!target) return null;
  board.ships = board.ships.filter(function keepShip(ship) {
    return ship.id !== shipId;
  });
  return target;
}

export function randomizeBoard(board, rng) {
  const random = rng || Math.random;
  for (let layoutAttempt = 0; layoutAttempt < 50; layoutAttempt += 1) {
    board.ships = [];
    board.shots = [];
    let layoutComplete = true;

    for (const shipDef of SHIP_DEFS) {
      let placed = false;
      for (let attempt = 0; attempt < 400 && !placed; attempt += 1) {
        const orientation = random() >= 0.5 ? "horizontal" : "vertical";
        const maxX = orientation === "horizontal" ? BOARD_SIZE - shipDef.length : BOARD_SIZE - 1;
        const maxY = orientation === "vertical" ? BOARD_SIZE - shipDef.length : BOARD_SIZE - 1;
        const x = Math.floor(random() * (maxX + 1));
        const y = Math.floor(random() * (maxY + 1));
        placed = placeShip(board, shipDef.id, x, y, orientation);
      }
      if (!placed) {
        layoutComplete = false;
        break;
      }
    }

    if (layoutComplete && isBoardReady(board)) return board;
  }
  throw new Error("无法生成有效舰队布局");
}

export function isBoardReady(board) {
  return SHIP_DEFS.every(function hasShip(shipDef) {
    return Boolean(getPlacedShip(board, shipDef.id));
  });
}

export function getUnplacedShipDefs(board) {
  return SHIP_DEFS.filter(function isUnplaced(shipDef) {
    return !getPlacedShip(board, shipDef.id);
  });
}

export function getShotAt(board, x, y) {
  return board.shots.find(function findShot(shot) {
    return shot.x === x && shot.y === y;
  }) || null;
}

export function resolveShot(board, x, y) {
  if (getShotAt(board, x, y)) {
    return { valid: false, reason: "duplicate" };
  }

  const ship = board.ships.find(function findTarget(candidate) {
    return candidate.cells.some(function containsCell(cell) {
      return cell.x === x && cell.y === y;
    });
  });
  const shot = {
    x: x,
    y: y,
    result: ship ? "hit" : "miss",
    shipId: ship ? ship.id : null,
  };

  if (ship) {
    ship.hits.push({ x: x, y: y });
  }
  board.shots.push(shot);

  const newlySunk = Boolean(ship && ship.hits.length === ship.length);
  if (newlySunk) {
    board.shots.forEach(function markSunk(existingShot) {
      if (existingShot.shipId === ship.id) existingShot.result = "sunk";
    });
    shot.result = "sunk";
  }

  return {
    valid: true,
    shot: shot,
    ship: ship || null,
    newlySunk: newlySunk,
  };
}

export function allShipsSunk(board) {
  return board.ships.length === SHIP_DEFS.length && board.ships.every(function isSunk(ship) {
    return ship.hits.length === ship.length;
  });
}

export function createAiMemory(rng) {
  const random = rng || Math.random;
  return {
    huntQueue: [],
    hitsToResolve: [],
    parityOffset: Math.floor(random() * 2),
  };
}

export function getNeighborCoords(x, y) {
  return [
    { x: x + 1, y: y },
    { x: x - 1, y: y },
    { x: x, y: y + 1 },
    { x: x, y: y - 1 },
  ].filter(function inBounds(coord) {
    return coord.x >= 0 && coord.x < BOARD_SIZE && coord.y >= 0 && coord.y < BOARD_SIZE;
  });
}

export function rememberAiShot(board, memory, shot) {
  const key = coordKey(shot.x, shot.y);
  memory.huntQueue = memory.huntQueue.filter(function keepQueued(coord) {
    return coordKey(coord.x, coord.y) !== key;
  });

  if (shot.result === "hit") {
    memory.hitsToResolve.push({ x: shot.x, y: shot.y });
    getNeighborCoords(shot.x, shot.y).forEach(function queueNeighbor(coord) {
      const seen = board.shots.some(function hasShot(entry) {
        return entry.x === coord.x && entry.y === coord.y;
      });
      const queued = memory.huntQueue.some(function isQueued(entry) {
        return entry.x === coord.x && entry.y === coord.y;
      });
      if (!seen && !queued) memory.huntQueue.push(coord);
    });
  }

  if (shot.result === "sunk" && shot.shipId) {
    const sunkShip = getPlacedShip(board, shot.shipId);
    const sunkKeys = new Set(sunkShip.cells.map(function toKey(cell) {
      return coordKey(cell.x, cell.y);
    }));
    memory.hitsToResolve = memory.hitsToResolve.filter(function unresolved(coord) {
      return !sunkKeys.has(coordKey(coord.x, coord.y));
    });
    memory.huntQueue = memory.huntQueue.filter(function keepTarget(coord) {
      return !sunkKeys.has(coordKey(coord.x, coord.y));
    });
  }
}

export function chooseAiTarget(board, difficulty, memory, rng) {
  const random = rng || Math.random;
  const taken = new Set(board.shots.map(function shotKey(shot) {
    return coordKey(shot.x, shot.y);
  }));
  const available = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (!taken.has(coordKey(x, y))) available.push({ x: x, y: y });
    }
  }
  if (!available.length) return null;
  if (difficulty === "easy") {
    return cloneCoord(available[Math.floor(random() * available.length)]);
  }

  const queued = memory.huntQueue.find(function queuedAvailable(coord) {
    return !taken.has(coordKey(coord.x, coord.y));
  });
  if (queued) return cloneCoord(queued);
  if (difficulty === "medium") {
    return cloneCoord(available[Math.floor(random() * available.length)]);
  }

  return chooseProbabilityTarget(board, available, taken, memory, random);
}

function chooseProbabilityTarget(board, available, taken, memory, rng) {
  const remainingShips = SHIP_DEFS.filter(function remains(shipDef) {
    const ship = getPlacedShip(board, shipDef.id);
    return !ship || ship.hits.length < ship.length;
  });
  const scores = new Map();
  available.forEach(function initializeScore(coord) {
    scores.set(coordKey(coord.x, coord.y), 0);
  });

  remainingShips.forEach(function scoreShip(shipDef) {
    ["horizontal", "vertical"].forEach(function scoreOrientation(orientation) {
      for (let y = 0; y < BOARD_SIZE; y += 1) {
        for (let x = 0; x < BOARD_SIZE; x += 1) {
          const cells = getShipCells(x, y, shipDef.length, orientation);
          if (!isWithinBounds(cells)) continue;
          if (cells.some(function crossesMiss(cell) {
            const shot = getShotAt(board, cell.x, cell.y);
            return shot && shot.result === "miss";
          })) continue;

          const placementKeys = new Set(cells.map(function cellKey(cell) {
            return coordKey(cell.x, cell.y);
          }));
          const resolvesKnownHits = memory.hitsToResolve.every(function includesHit(hit) {
            return placementKeys.has(coordKey(hit.x, hit.y));
          });
          if (memory.hitsToResolve.length && !resolvesKnownHits) continue;

          cells.forEach(function addScore(cell) {
            const key = coordKey(cell.x, cell.y);
            if (!taken.has(key)) scores.set(key, (scores.get(key) || 0) + 1);
          });
        }
      }
    });
  });

  let bestScore = -1;
  let bestTargets = [];
  available.forEach(function compareTarget(coord) {
    const key = coordKey(coord.x, coord.y);
    const parityBonus = (coord.x + coord.y) % 2 === memory.parityOffset ? 0.2 : 0;
    const score = (scores.get(key) || 0) + parityBonus;
    if (score > bestScore) {
      bestScore = score;
      bestTargets = [coord];
    } else if (score === bestScore) {
      bestTargets.push(coord);
    }
  });

  return cloneCoord(bestTargets[Math.floor(rng() * bestTargets.length)]);
}
