// Klasemen: rata-rata +/- par dari X ronde terbaik (skor terendah), hanya APPROVED.
function computeRanking(players, rounds, bestX) {
  const ou = (r) => r.total_score - r.total_par;
  const approved = rounds.filter((r) => r.status === "APPROVED");
  const byP = {};
  approved.forEach((r) => (byP[r.player_id] = byP[r.player_id] || []).push(r));
  const all = players.map((p) => {
    const list = (byP[p.id] || []).slice().sort((a, b) => ou(a) - ou(b));
    const best = list.slice(0, bestX);
    return {
      id: p.id, name: p.name, unit: p.unit, assignment: p.assignment,
      count: list.length,
      bestOU: list.length ? ou(list[0]) : null,
      avgOU: best.length ? best.reduce((a, b) => a + ou(b), 0) / best.length : null,
    };
  });
  const ranked = all.filter((r) => r.count > 0)
    .sort((a, b) => a.avgOU - b.avgOU || a.bestOU - b.bestOU || b.count - a.count);
  ranked.forEach((r, i) => (r.rank = i + 1));
  const rest = all.filter((r) => r.count === 0).sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked, ...rest];
}
module.exports = { computeRanking };
