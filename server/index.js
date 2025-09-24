import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();
const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.NEON_DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('NEON_DATABASE_URL not set. Set it to connect to Neon Postgres.');
}
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// --- Schema bootstrap ---
async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'active',
    board_size INT NOT NULL DEFAULT 20,
    next_player_index INT NOT NULL DEFAULT 0,
    variant TEXT NOT NULL DEFAULT 'classic'
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    color TEXT NOT NULL,
    order_index INT NOT NULL,
    name TEXT NOT NULL
  );`);
  await pool.query(`CREATE TABLE IF NOT EXISTS moves (
    id UUID PRIMARY KEY,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_color TEXT NOT NULL,
    piece_key TEXT,
    rotation INT,
    flipped BOOLEAN,
    cells JSONB,
    passed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    turn_number INT NOT NULL
  );`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_moves_game_created ON moves(game_id, created_at);`);
}

// Blokus piece definitions (canonical shapes with origin at (0,0))
// Each piece is a set of [x,y] squares.
// Keys follow common naming: monomino (1), domino (2), triominoes, tetrominoes, pentominoes including Blokus unique shapes.
// We use standard 21 pieces: 1x1, 1x2, and 19 pentomino/tri/tetromino variants.
const PIECES = {
  // size 1..5
  I1: [[0,0]],
  I2: [[0,0],[1,0]],
  I3: [[0,0],[1,0],[2,0]],
  I4: [[0,0],[1,0],[2,0],[3,0]],
  I5: [[0,0],[1,0],[2,0],[3,0],[4,0]],
  V3: [[0,0],[0,1],[1,0]],
  L4: [[0,0],[0,1],[0,2],[1,0]],
  Z4: [[0,0],[1,0],[1,1],[2,1]],
  O4: [[0,0],[1,0],[0,1],[1,1]], // square
  T5: [[0,0],[1,0],[2,0],[1,1],[1,2]],
  L5: [[0,0],[0,1],[0,2],[0,3],[1,0]],
  Y5: [[0,0],[1,0],[2,0],[3,0],[1,1]],
  N5: [[0,0],[1,0],[1,1],[2,1],[3,1]],
  Z5: [[0,0],[1,0],[2,0],[2,1],[3,1]],
  U5: [[0,0],[2,0],[0,1],[1,1],[2,1]],
  V5: [[0,0],[0,1],[0,2],[1,0],[2,0]],
  W5: [[0,0],[1,0],[1,1],[2,1],[2,2]],
  X5: [[1,0],[0,1],[1,1],[2,1],[1,2]],
  P5: [[0,0],[1,0],[0,1],[1,1],[0,2]],
  F5: [[1,0],[0,1],[1,1],[1,2],[2,2]],
  T4: [[0,0],[1,0],[2,0],[1,1]] // extra tetromino for variety
};

const DEFAULT_COLORS = ['blue','yellow','red','green'];
const START_CORNERS = {
  blue: [0,0],
  yellow: [19,0],
  red: [0,19],
  green: [19,19]
};

function rotate(point, times) {
  // rotate 90deg clockwise times times around origin
  let [x,y] = point;
  times = ((times % 4) + 4) % 4;
  for (let i=0;i<times;i++) {
    [x,y] = [y, -x];
  }
  return [x,y];
}
function flip(point) { return [-point[0], point[1]]; }
function normalize(cells) {
  let minX = Math.min(...cells.map(p=>p[0]));
  let minY = Math.min(...cells.map(p=>p[1]));
  return cells.map(([x,y])=>[x-minX,y-minY]);
}
function transformShape(shape, rotationTimes=0, flipped=false) {
  let cells = shape.map(p=>p);
  if (flipped) cells = cells.map(flip);
  cells = cells.map(p=>rotate(p, rotationTimes));
  return normalize(cells);
}
function translate(cells, dx, dy) {
  return cells.map(([x,y])=>[x+dx,y+dy]);
}
function keyOfCell(x,y) { return `${x},${y}`; }

async function getGameState(gameId) {
  const { rows: gameRows } = await pool.query('SELECT * FROM games WHERE id=$1', [gameId]);
  if (gameRows.length === 0) return null;
  const game = gameRows[0];
  const { rows: playerRows } = await pool.query('SELECT * FROM players WHERE game_id=$1 ORDER BY order_index', [gameId]);
  const { rows: moveRows } = await pool.query('SELECT * FROM moves WHERE game_id=$1 ORDER BY turn_number', [gameId]);

  // Build occupancy maps and used pieces per color
  const boardSize = game.board_size;
  const occupied = new Map(); // key -> color
  const playerCells = { blue: new Set(), yellow: new Set(), red: new Set(), green: new Set() };
  const usedPieces = { blue: new Set(), yellow: new Set(), red: new Set(), green: new Set() };
  let lastPlayerIndex = null;
  for (const m of moveRows) {
    if (!m.passed && m.cells) {
      const cells = m.cells;
      for (const [x,y] of cells) {
        occupied.set(keyOfCell(x,y), m.player_color);
        playerCells[m.player_color].add(keyOfCell(x,y));
      }
      usedPieces[m.player_color].add(m.piece_key);
    }
    const idx = playerRows.find(p=>p.color===m.player_color)?.order_index ?? 0;
    lastPlayerIndex = idx;
  }
  // Next player index from table
  const nextIndex = game.next_player_index;

  // Remaining pieces per color
  const pieceKeys = Object.keys(PIECES);
  const remaining = {};
  for (const p of playerRows) {
    remaining[p.color] = pieceKeys.filter(k=>!usedPieces[p.color].has(k));
  }

  // Detect end
  const recentPasses = moveRows.slice(-playerRows.length);
  const everyonePassed = recentPasses.length === playerRows.length && recentPasses.every(m=>m.passed);
  let status = everyonePassed ? 'finished' : game.status;

  // Scores: -remaining squares, bonus +15 all used, +5 if last piece I1
  let scores = {};
  if (status === 'finished') {
    for (const p of playerRows) {
      const remPieces = pieceKeys.filter(k=>!usedPieces[p.color].has(k));
      const sizeOf = k => PIECES[k].length;
      const remSquares = remPieces.reduce((a,k)=>a+sizeOf(k),0);
      let score = -remSquares;
      if (remPieces.length === 0) score += 15;
      if (usedPieces[p.color].has('I1') && remPieces.length === 0) score += 5;
      scores[p.color] = score;
    }
  }

  return {
    game: { id: game.id, created_at: game.created_at, status, board_size: boardSize, next_player_index: nextIndex },
    players: playerRows,
    moves: moveRows,
    remaining,
    scores,
    occupiedCount: occupied.size
  };
}

function isWithinBoard(cells, size) {
  return cells.every(([x,y])=> x>=0 && y>=0 && x<size && y<size);
}
function hasCornerContact(cells, playerSet) {
  // at least one cell diagonally touches an existing same-color cell
  for (const [x,y] of cells) {
    const corners = [[x-1,y-1],[x-1,y+1],[x+1,y-1],[x+1,y+1]];
    for (const [cx,cy] of corners) {
      if (playerSet.has(keyOfCell(cx,cy))) return true;
    }
  }
  return false;
}
function hasEdgeContact(cells, playerSet) {
  for (const [x,y] of cells) {
    const sides = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
    for (const [sx,sy] of sides) {
      if (playerSet.has(keyOfCell(sx,sy))) return true;
    }
  }
  return false;
}

app.get('/api/health', (_req,res)=> res.json({ ok: true }));
app.get('/api/pieces', (_req,res)=> {
  res.json({ pieces: Object.fromEntries(Object.entries(PIECES).map(([k,v])=>[k,v])) });
});

app.post('/api/games', async (req,res)=>{
  try {
    const { players } = req.body || {};
    const id = uuidv4();
    const colors = (players && Array.isArray(players) && players.length>0) ? players : DEFAULT_COLORS;
    await pool.query('INSERT INTO games(id) VALUES($1)', [id]);
    const values = [];
    let idx = 0;
    for (const color of colors) {
      const pid = uuidv4();
      const name = color.charAt(0).toUpperCase()+color.slice(1);
      values.push(pool.query('INSERT INTO players(id, game_id, color, order_index, name) VALUES($1,$2,$3,$4,$5)', [pid,id,color,idx,name]));
      idx++;
    }
    await Promise.all(values);
    const state = await getGameState(id);
    res.json(state);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_create_game' });
  }
});

app.get('/api/games/:id', async (req,res)=>{
  const id = req.params.id;
  const state = await getGameState(id);
  if (!state) return res.status(404).json({ error: 'not_found' });
  res.json(state);
});

app.post('/api/games/:id/skip', async (req,res)=>{
  try {
    const gameId = req.params.id;
    const { player_color } = req.body;
    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: 'not_found' });
    const players = state.players;
    const current = players[state.game.next_player_index];
    if (current.color !== player_color) return res.status(400).json({ error: 'not_your_turn' });

    const turnNumber = state.moves.length + 1;
    await pool.query('INSERT INTO moves(id, game_id, player_color, passed, turn_number) VALUES($1,$2,$3,$4,$5)', [uuidv4(), gameId, player_color, true, turnNumber]);
    // advance next_player_index
    const nextIndex = (state.game.next_player_index + 1) % players.length;
    await pool.query('UPDATE games SET next_player_index=$2 WHERE id=$1', [gameId, nextIndex]);

    const newState = await getGameState(gameId);
    res.json(newState);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_skip' });
  }
});

app.post('/api/games/:id/place', async (req,res)=>{
  try {
    const gameId = req.params.id;
    const { player_color, piece_key, rotation=0, flipped=false, position } = req.body;
    if (!PIECES[piece_key]) return res.status(400).json({ error: 'invalid_piece' });
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') return res.status(400).json({ error: 'invalid_position' });

    const state = await getGameState(gameId);
    if (!state) return res.status(404).json({ error: 'not_found' });
    const players = state.players;
    const current = players[state.game.next_player_index];
    if (current.color !== player_color) return res.status(400).json({ error: 'not_your_turn' });

    // compute occupied and sets
    const occupied = new Map();
    const playerSets = { blue: new Set(), yellow: new Set(), red: new Set(), green: new Set() };
    for (const m of state.moves) {
      if (!m.passed && m.cells) {
        for (const [x,y] of m.cells) {
          occupied.set(keyOfCell(x,y), m.player_color);
          playerSets[m.player_color].add(keyOfCell(x,y));
        }
      }
    }

    const transformed = transformShape(PIECES[piece_key], rotation, flipped);
    const placed = translate(transformed, position.x, position.y);

    // Validations
    if (!isWithinBoard(placed, state.game.board_size)) return res.status(400).json({ error: 'out_of_bounds' });
    for (const [x,y] of placed) {
      if (occupied.has(keyOfCell(x,y))) return res.status(400).json({ error: 'overlap' });
    }

    const mySet = playerSets[player_color];
    const isFirstMove = !state.moves.some(m=>m.player_color===player_color && !m.passed);
    if (isFirstMove) {
      const corner = START_CORNERS[player_color];
      const occupiesCorner = placed.some(([x,y])=> x===corner[0] && y===corner[1]);
      if (!occupiesCorner) return res.status(400).json({ error: 'first_move_must_cover_corner' });
    } else {
      if (!hasCornerContact(placed, mySet)) return res.status(400).json({ error: 'must_touch_same_color_corner' });
    }
    if (hasEdgeContact(placed, mySet)) return res.status(400).json({ error: 'cannot_touch_same_color_edge' });

    const turnNumber = state.moves.length + 1;
    await pool.query(
      'INSERT INTO moves(id, game_id, player_color, piece_key, rotation, flipped, cells, passed, turn_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuidv4(), gameId, player_color, piece_key, rotation|0, !!flipped, JSON.stringify(placed), false, turnNumber]
    );

    // Advance next player
    const nextIndex = (state.game.next_player_index + 1) % players.length;
    await pool.query('UPDATE games SET next_player_index=$2 WHERE id=$1', [gameId, nextIndex]);

    const newState = await getGameState(gameId);
    res.json(newState);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_place' });
  }
});

app.listen(PORT, () => {
  console.log(`Blokus backend listening on port ${PORT}`);
});

