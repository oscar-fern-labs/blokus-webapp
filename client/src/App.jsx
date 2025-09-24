import React, { useEffect, useMemo, useState } from 'react';
import { getPieces, createGame, getGame, place, skip } from './api.js';

const BOARD_SIZE = 20;

const COLORS = {
  blue: '#2b6cb0',
  yellow: '#d69e2e',
  red: '#c53030',
  green: '#2f855a'
};

function Cell({ x, y, value, onClick, highlight }) {
  const style = {
    width: 24, height: 24,
    border: '1px solid #ccc',
    background: value ? COLORS[value] : highlight ? 'rgba(0,0,0,0.1)' : 'white',
    boxSizing: 'border-box'
  };
  return <div onClick={()=>onClick(x,y)} style={style} />;
}

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

function PiecePreview({ piece, rotation, flipped, anchor, color, isValid=true }) {
  if (!piece || !anchor) return null;
  const tr = transform(piece, rotation, flipped);
  const style = { position:'absolute', left: 0, top: 0, pointerEvents:'none' };
  const cellBg = isValid ? (COLORS[color]+'66') : '#ef444433';
  const cellBorder = isValid ? '1px dashed #4ade80' : '1px dashed #ef4444';
  return (
    <div style={style}>
      {tr.map(([dx,dy], idx)=>{
        const left = (anchor.x + dx)*24;
        const top = (anchor.y + dy)*24;
        return <div key={idx} style={{ position:'absolute', left, top, width:24, height:24, background: cellBg, border: cellBorder, borderRadius:4 }} />
      })}
    </div>
  );
}

function transform(shape, rotation=0, flipped=false){
  let cells = shape.map(([x,y])=>[x,y]);
  const rot = ((rotation%4)+4)%4;
  if (flipped) cells = cells.map(([x,y])=>[-x,y]);
  for(let i=0;i<rot;i++) cells = cells.map(([x,y])=>[y,-x]);
  // normalize
  let minX = Math.min(...cells.map(c=>c[0]));
  let minY = Math.min(...cells.map(c=>c[1]));
  cells = cells.map(([x,y])=>[x-minX,y-minY]);
  return cells;
}

function cornerFor(color){
  switch(color){
    case 'blue': return {x:0, y:0};
    case 'yellow': return {x:BOARD_SIZE-1, y:0};
    case 'red': return {x:BOARD_SIZE-1, y:BOARD_SIZE-1};
    case 'green': return {x:0, y:BOARD_SIZE-1};
    default: return null;
  }
}

function playerHasAny(color, occ){
  for (let yy=0; yy<BOARD_SIZE; yy++){
    for (let xx=0; xx<BOARD_SIZE; xx++){
      if (occ[yy][xx] === color) return true;
    }
  }
  return false;
}

function CornerHint({ color }){
  if (!color) return null;
  const start = cornerFor(color);
  if (!start) return null;
  const left = start.x * 24;
  const top = start.y * 24;
  return <div style={{ position:'absolute', left, top, width:24, height:24, border:'2px solid '+COLORS[color], borderRadius:4, boxShadow:'0 0 0 2px #fff', pointerEvents:'none' }} title={`${color} starts here`} />;
}

function canPlaceLocal({ piece, rotation, flipped, anchor, color, occ, game }){
  if (!piece || !anchor || !color || !occ) return false;
  const tr = transform(piece, rotation, flipped);
  // Build absolute target cells
  const targets = tr.map(([dx,dy]) => ({ x: anchor.x + dx, y: anchor.y + dy }));
  // Bounds and empty checks
  for (const {x,y} of targets) {
    if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return false;
    if (occ[y][x]) return false;
  }
  // Determine if this player has already placed any piece
  const hasAny = playerHasAny(color, occ);
  // 4-neighbor adjacency with same color is not allowed
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const {x,y} of targets) {
    for (const [dx,dy] of dirs) {
      const nx = x+dx, ny = y+dy;
      if (nx>=0 && ny>=0 && nx<BOARD_SIZE && ny<BOARD_SIZE) {
        if (occ[ny][nx] === color) return false;
      }
    }
  }
  // Must touch same color diagonally unless it's the very first move covering its corner
  let touchesDiagonal = false;
  const diags = [[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const {x,y} of targets) {
    for (const [dx,dy] of diags) {
      const nx = x+dx, ny = y+dy;
      if (nx>=0 && ny>=0 && nx<BOARD_SIZE && ny<BOARD_SIZE) {
        if (occ[ny][nx] === color) {
          touchesDiagonal = true;
          break;
        }
      }
    }
    if (touchesDiagonal) break;
  }
  if (!hasAny) {
    // First move: one of the cells must be exactly at the player's starting corner
    const start = cornerFor(color);
    const coversCorner = targets.some(({x,y})=> x===start.x && y===start.y);
    return coversCorner; // server will also enforce; this helps preview
  }
  // Subsequent moves: must touch diagonally at least once
  return touchesDiagonal;
}

export default function App(){
  const query = useQuery();
  const [pieces, setPieces] = useState({});
  const [game, setGame] = useState(null);
  const [gameId, setGameId] = useState(query.get('gameId') || null);
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [hover, setHover] = useState(null);
  const [error, setError] = useState('');

  useEffect(()=>{
    getPieces().then(d=> setPieces(d.pieces||{}));
  },[]);

  useEffect(()=>{
    async function boot(){
      if (!gameId) {
        const st = await createGame();
        setGame(st);
        setGameId(st.game.id);
        const url = new URL(window.location.href);
        url.searchParams.set('gameId', st.game.id);
        window.history.replaceState({}, '', url.toString());
      } else {
        const st = await getGame(gameId);
        setGame(st);
      }
    }
    boot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[gameId]);

  const currentColor = game?.players?.[game?.game?.next_player_index||0]?.color;

  function boardOccupancy(){
    const occ = Array.from({length:BOARD_SIZE},()=>Array(BOARD_SIZE).fill(null));
    if (!game) return occ;
    for(const m of game.moves||[]){
      if (!m.passed && m.cells){
        for(const [x,y] of m.cells){
          occ[y][x] = m.player_color;
        }
      }
    }
    return occ;
  }

  const occ = boardOccupancy();

  async function onCellClick(x,y){
    setError('');
    if (!selectedPiece || !currentColor) return;
    try {
      const st = await place(game.game.id, { player_color: currentColor, piece_key: selectedPiece, rotation, flipped, position: { x, y } });
      setGame(st);
      setSelectedPiece(null);
    } catch(e){
      setError(e.error||'Placement failed');
    }
  }

  function onSkip(){
    if (!game) return;
    skip(game.game.id, currentColor).then(setGame).catch(e=>setError(e.error||'Skip failed'));
  }

  function remainingFor(color){
    if (!game) return [];
    return game.remaining?.[color]||[];
  }

  useEffect(()=>{
    function onKey(e){
      if (e.key === 'r' || e.key === 'R') setRotation(r=> (r+1)%4);
      if (e.key === 'f' || e.key === 'F') setFlipped(f=> !f);
    }
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  },[]);

  const gridStyle = { position:'relative', display:'grid', gridTemplateColumns:`repeat(${BOARD_SIZE},24px)`, gridTemplateRows:`repeat(${BOARD_SIZE},24px)`, gap:0, border:'2px solid #333', borderRadius:12, boxShadow:'0 8px 24px rgba(16,24,40,0.12)', width: BOARD_SIZE*24, height: BOARD_SIZE*24 };

  return (
    <div style={{ fontFamily:'Inter, ui-sans-serif, system-ui, Arial, sans-serif', padding:24, display:'grid', gridTemplateColumns:'1fr 320px', gap:24, minHeight:'100vh', background:'#f3f4f6' }}>
      <div>
        <h1>Blokus</h1>
        <div style={{display:'flex', alignItems:'baseline', gap:12, marginBottom:8}}>
          <h1 style={{margin:0, fontSize:28}}>Blokus</h1>
          <span style={{fontSize:13, color:'#6b7280'}}>Hotseat</span>
        </div>

        {game && (
          <div style={{marginBottom:12, display:'flex', gap:16, color:'#4b5563'}}>
            <div style={{fontSize:13, background:'#fff', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8}}>Game: {game.game.id.slice(0,8)}</div>
            <div style={{fontSize:13, background:'#fff', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8}}>Next: <b style={{color:COLORS[currentColor]}}>{currentColor}</b></div>
            <div style={{fontSize:13, background:'#fff', padding:'6px 10px', border:'1px solid #e5e7eb', borderRadius:8}}>Moves: {game.moves.length}</div>
          </div>
        )}
        <div style={gridStyle}
          onMouseLeave={()=>setHover(null)}
>
          <CornerHint color={currentColor} />
          {Array.from({length:BOARD_SIZE * BOARD_SIZE}).map((_, i) => {
          <CornerHint color={currentColor} />

            const x = i % BOARD_SIZE; const y = Math.floor(i / BOARD_SIZE);
            return (
              <div key={`${x},${y}`}
                onMouseEnter={()=>setHover({x,y})}
                onClick={()=>onCellClick(x,y)}
              >
                <Cell x={x} y={y} value={occ[y][x]} onClick={onCellClick} />
              </div>
            );
          })}
          <PiecePreview piece={selectedPiece?pieces[selectedPiece]:null} rotation={rotation} flipped={flipped} anchor={hover} color={currentColor} isValid={canPlaceLocal({ piece: selectedPiece?pieces[selectedPiece]:null, rotation, flipped, anchor: hover, color: currentColor, occ, game })} />
        </div>
        <div style={{marginTop:8, display:'flex', gap:8}}>
          <button onClick={()=>setRotation(r=> (r+1)%4)}>Rotate (R)</button>
          <button onClick={()=>setFlipped(f=> !f)}>Flip (F)</button>
          <button onClick={onSkip}>Skip</button>
        </div>

        {game && (
          <div style={{position:'relative', marginTop:8}}>
            {/* Corner markers for the four players */}
            <div style={{position:'absolute', left:-10, top:-10, width:8, height:8, borderRadius:4, background:COLORS['blue'], boxShadow:'0 0 0 2px #fff'}} title="Blue starts here" />
            <div style={{position:'absolute', right:-10, top:-10, width:8, height:8, borderRadius:4, background:COLORS['yellow'], boxShadow:'0 0 0 2px #fff'}} title="Yellow starts here" />
            <div style={{position:'absolute', right:-10, bottom:-10, width:8, height:8, borderRadius:4, background:COLORS['red'], boxShadow:'0 0 0 2px #fff'}} title="Red starts here" />
            <div style={{position:'absolute', left:-10, bottom:-10, width:8, height:8, borderRadius:4, background:COLORS['green'], boxShadow:'0 0 0 2px #fff'}} title="Green starts here" />
          </div>
        )}

        {error && <div style={{color:'#b91c1c', background:'#fee2e2', border:'1px solid #fecaca', padding:'8px 10px', borderRadius:8, marginTop:8}}><b>Invalid placement</b>: {error}</div>}
      </div>
      <div>
        <h3>Pieces ({currentColor})</h3>
        <div style={{display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, maxWidth:300}}>
          {remainingFor(currentColor).map(k=> (
            <button key={k} onClick={()=> setSelectedPiece(k)} style={{padding:6, border:selectedPiece===k? '2px solid #333':'1px solid #aaa', textAlign:'left'}}>
              {k}
            </button>
          ))}

        </div>
        <h4 style={{marginTop:16}}>Scores</h4>
        <pre style={{background:'#f9f9f9', padding:8}}>{JSON.stringify(game?.scores||{}, null, 2)}</pre>
      </div>
    </div>
  );
}








