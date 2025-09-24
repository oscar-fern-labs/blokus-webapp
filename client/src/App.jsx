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

function PiecePreview({ piece, rotation, flipped, anchor, color }) {
  if (!piece || !anchor) return null;
  const tr = transform(piece, rotation, flipped);
  const style = { position:'absolute', left: 0, top: 0, pointerEvents:'none' };
  return (
    <div style={style}>
      {tr.map(([dx,dy], idx)=>{
        const left = (anchor.x + dx)*24;
        const top = (anchor.y + dy)*24;
        return <div key={idx} style={{ position:'absolute', left, top, width:24, height:24, background: COLORS[color]+'88', border:'1px dashed #555' }} />
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

  const gridStyle = { position:'relative', display:'grid', gridTemplateColumns:`repeat(${BOARD_SIZE},24px)`, gridTemplateRows:`repeat(${BOARD_SIZE},24px)`, gap:0, border:'2px solid #333', width: BOARD_SIZE*24, height: BOARD_SIZE*24 };

  return (
    <div style={{ fontFamily:'system-ui, sans-serif', padding:16, display:'flex', gap:16 }}>
      <div>
        <h1>Blokus</h1>
        {game && (
          <div style={{marginBottom:8}}>
            <div>Game: {game.game.id.slice(0,8)}</div>
            <div>Next: <b style={{color:COLORS[currentColor]}}>{currentColor}</b></div>
            <div>Moves: {game.moves.length}</div>
          </div>
        )}
        <div style={gridStyle}
          onMouseLeave={()=>setHover(null)}
        >
          {Array.from({length:BOARD_SIZE * BOARD_SIZE}).map((_, i) => {
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
          <PiecePreview piece={selectedPiece?pieces[selectedPiece]:null} rotation={rotation} flipped={flipped} anchor={hover} color={currentColor} />
        </div>
        <div style={{marginTop:8, display:'flex', gap:8}}>
          <button onClick={()=>setRotation(r=> (r+1)%4)}>Rotate (R)</button>
          <button onClick={()=>setFlipped(f=> !f)}>Flip (F)</button>
          <button onClick={onSkip}>Skip</button>
        </div>
        {error && <div style={{color:'crimson', marginTop:8}}>Error: {error}</div>}
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


