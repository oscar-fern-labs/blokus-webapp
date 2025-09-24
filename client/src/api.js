const API_BASE = import.meta.env.VITE_API_BASE || "https://blokus-backend-morphvm-oq9vptwe.http.cloud.morph.so";

export async function getPieces() {
  const res = await fetch(`${API_BASE}/api/pieces`);
  return res.json();
}
export async function createGame(players) {
  const res = await fetch(`${API_BASE}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players }) });
  return res.json();
}
export async function getGame(id) {
  const res = await fetch(`${API_BASE}/api/games/${id}`);
  return res.json();
}
export async function place(gameId, payload) {
  const res = await fetch(`${API_BASE}/api/games/${gameId}/place`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const e = await res.json().catch(()=>({error:'unknown'}));
    throw e;
  }
  return res.json();
}
export async function skip(gameId, player_color) {
  const res = await fetch(`${API_BASE}/api/games/${gameId}/skip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_color }) });
  if (!res.ok) {
    const e = await res.json().catch(()=>({error:'unknown'}));
    throw e;
  }
  return res.json();
}

