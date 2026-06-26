const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool, q } = require("./db");
const { hash, verify, sign, authMiddleware, requireAdmin } = require("./auth");
const { computeRanking } = require("./ranking");
const { ocrScorecard } = require("./ocr");
const { runSchema, seedIfEmpty } = require("./seed");

const app = express();

// --- CORS (dijalankan paling awal, sebelum parser, agar preflight selalu dapat header) ---
const allowed = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                 // curl / same-origin / app native
    if (allowed.includes("*") || allowed.includes(origin)) return cb(null, true);
    return cb(null, false);                              // origin tak diizinkan: tanpa header CORS
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));                     // tangani semua preflight

app.use(express.json({ limit: "20mb" }));

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use("/uploads", express.static(UPLOAD_DIR));

const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error(e); res.status(500).json({ error: e.message || "Server error" });
});
function saveImage(b64, mediaType) {
  const ext = (mediaType || "image/jpeg").split("/")[1].replace("jpeg", "jpg");
  const name = crypto.randomUUID() + "." + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(b64, "base64"));
  return "/uploads/" + name;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---------------- AUTH ----------------
app.post("/api/auth/login", wrap(async (req, res) => {
  const userId = (req.body.userId || "").toLowerCase().trim();
  const password = req.body.password || "";
  const a = await q("SELECT * FROM admins WHERE lower(user_id)=$1", [userId]);
  const p = a.rows.length ? null : await q("SELECT * FROM players WHERE lower(user_id)=$1", [userId]);
  const rec = a.rows[0] || (p && p.rows[0]);
  const role = a.rows[0] ? "admin" : "player";
  if (!rec || !(await verify(password, rec.password_hash)))
    return res.status(401).json({ error: "User ID atau password salah" });
  if (!rec.active) return res.status(403).json({ error: "Akun nonaktif" });
  const token = sign({ sub: rec.id, role, name: rec.name, userId: rec.user_id });
  res.json({ token, role, profile: { id: rec.id, name: rec.name, userId: rec.user_id } });
}));
app.get("/api/auth/me", authMiddleware, (req, res) => res.json(req.user));

// Registrasi pemain mandiri (publik). Akun langsung aktif & auto-login.
// Subuk butuh persetujuan panitia: ganti active:true -> false, lalu panitia aktifkan di konsol.
app.post("/api/auth/register", wrap(async (req, res) => {
  const name = (req.body.name || "").trim();
  const unit = (req.body.unit || "").trim();
  const assignment = (req.body.assignment || unit).trim();
  const userId = (req.body.userId || "").toLowerCase().trim();
  const password = req.body.password || "";
  if (!name || !unit || !userId || !password) return res.status(400).json({ error: "Lengkapi nama, unit, User ID, dan password" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userId)) return res.status(400).json({ error: "User ID harus berupa email yang valid" });
  if (password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter" });
  const dup = await q("SELECT 1 FROM players WHERE lower(user_id)=$1 UNION SELECT 1 FROM admins WHERE lower(user_id)=$1", [userId]);
  if (dup.rows.length) return res.status(409).json({ error: "User ID sudah terdaftar. Silakan login." });
  const r = await q(
    `INSERT INTO players (user_id, password_hash, name, unit, assignment, active)
     VALUES ($1,$2,$3,$4,$5,true) RETURNING id, user_id, name`,
    [userId, await hash(password), name, unit, assignment]);
  const rec = r.rows[0];
  const token = sign({ sub: rec.id, role: "player", name: rec.name, userId: rec.user_id });
  res.status(201).json({ token, role: "player", profile: { id: rec.id, name: rec.name, userId: rec.user_id } });
}));

// ---------------- SETTINGS ----------------
app.get("/api/settings", authMiddleware, wrap(async (_req, res) => {
  const r = await q("SELECT * FROM settings WHERE id=1");
  res.json(r.rows[0]);
}));
app.put("/api/settings", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { season_name, best_x, geofence_km } = req.body;
  const r = await q(
    "UPDATE settings SET season_name=$1, best_x=$2, geofence_km=$3 WHERE id=1 RETURNING *",
    [season_name, best_x, geofence_km]);
  res.json(r.rows[0]);
}));

// ---------------- PLAYERS ----------------
app.get("/api/players", authMiddleware, wrap(async (_req, res) => {
  const r = await q("SELECT id,user_id,name,unit,assignment,active,created_at FROM players ORDER BY name");
  res.json(r.rows);
}));
app.post("/api/players", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { name, unit, assignment, userId, password, active } = req.body;
  if (!name || !unit || !userId || !password) return res.status(400).json({ error: "Data wajib belum lengkap" });
  const dup = await q(
    "SELECT 1 FROM players WHERE lower(user_id)=$1 UNION SELECT 1 FROM admins WHERE lower(user_id)=$1",
    [userId.toLowerCase()]);
  if (dup.rows.length) return res.status(409).json({ error: "User ID sudah dipakai" });
  const r = await q(
    `INSERT INTO players (user_id,password_hash,name,unit,assignment,active)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,user_id,name,unit,assignment,active`,
    [userId.toLowerCase(), await hash(password), name, unit, assignment || unit, active !== false]);
  res.status(201).json(r.rows[0]);
}));
app.put("/api/players/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { name, unit, assignment, userId, password, active } = req.body;
  const sets = ["name=$2", "unit=$3", "assignment=$4", "user_id=$5", "active=$6"];
  const params = [req.params.id, name, unit, assignment, (userId || "").toLowerCase(), active !== false];
  let sql = `UPDATE players SET ${sets.join(",")}`;
  if (password) { sql += `, password_hash=$7`; params.push(await hash(password)); }
  sql += ` WHERE id=$1 RETURNING id,user_id,name,unit,assignment,active`;
  const r = await q(sql, params);
  res.json(r.rows[0]);
}));
app.delete("/api/players/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  await q("DELETE FROM players WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- COURSES ----------------
app.get("/api/courses", authMiddleware, wrap(async (_req, res) => {
  const r = await q("SELECT * FROM courses ORDER BY name");
  res.json(r.rows);
}));
app.post("/api/courses", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { name, city, holes, lat, lng } = req.body;
  const r = await q(
    "INSERT INTO courses (name,city,holes,lat,lng) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [name, city, holes || 18, lat, lng]);
  res.status(201).json(r.rows[0]);
}));
app.put("/api/courses/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { name, city, holes, lat, lng } = req.body;
  const r = await q(
    "UPDATE courses SET name=$2,city=$3,holes=$4,lat=$5,lng=$6 WHERE id=$1 RETURNING *",
    [req.params.id, name, city, holes, lat, lng]);
  res.json(r.rows[0]);
}));
app.delete("/api/courses/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const used = await q("SELECT 1 FROM rounds WHERE course_id=$1 LIMIT 1", [req.params.id]);
  if (used.rows.length) return res.status(409).json({ error: "Lapangan dipakai oleh ronde" });
  await q("DELETE FROM courses WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- ROUNDS ----------------
app.get("/api/rounds", authMiddleware, wrap(async (req, res) => {
  const params = [];
  let sql = `SELECT r.*, p.name AS player_name, p.unit AS player_unit
             FROM rounds r JOIN players p ON p.id=r.player_id`;
  const where = [];
  if (req.user.role === "player") { params.push(req.user.sub); where.push(`r.player_id=$${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`r.status=$${params.length}`); }
  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY r.play_date DESC, r.submitted_at DESC";
  const r = await q(sql, params);
  res.json(r.rows);
}));
app.post("/api/rounds", authMiddleware, wrap(async (req, res) => {
  const playerId = req.user.role === "player" ? req.user.sub : req.body.playerId;
  const { courseId, courseName, playDate, parVector, scoreVector, distanceKm, flags, photoUrl, ocrRaw } = req.body;
  if (!playerId || !courseName || !playDate || !parVector || !scoreVector)
    return res.status(400).json({ error: "Data ronde belum lengkap" });
  const r = await q(
    `INSERT INTO rounds (player_id,course_id,course_name,play_date,total_score,total_par,
       par_vector,score_vector,status,distance_km,flags,photo_url,ocr_raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NEEDS_REVIEW',$9,$10,$11,$12) RETURNING *`,
    [playerId, courseId || null, courseName, playDate, sum(scoreVector), sum(parVector),
     JSON.stringify(parVector), JSON.stringify(scoreVector), distanceKm || null,
     JSON.stringify(flags || []), photoUrl || null, ocrRaw ? JSON.stringify(ocrRaw) : null]);
  res.status(201).json(r.rows[0]);
}));
app.put("/api/rounds/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { parVector, scoreVector, adminNote, status } = req.body;
  const decided = status === "APPROVED" || status === "REJECTED";
  const r = await q(
    `UPDATE rounds SET par_vector=$2, score_vector=$3, total_par=$4, total_score=$5,
       admin_note=$6, status=$7,
       reviewed_by=CASE WHEN $8 THEN $9 ELSE reviewed_by END,
       reviewed_at=CASE WHEN $8 THEN now() ELSE reviewed_at END
     WHERE id=$1 RETURNING *`,
    [req.params.id, JSON.stringify(parVector), JSON.stringify(scoreVector),
     sum(parVector), sum(scoreVector), adminNote || null, status, decided, req.user.sub]);
  res.json(r.rows[0]);
}));
app.delete("/api/rounds/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  await q("DELETE FROM rounds WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- LEADERBOARD ----------------
app.get("/api/leaderboard", authMiddleware, wrap(async (_req, res) => {
  const [players, rounds, settings] = await Promise.all([
    q("SELECT id,name,unit,assignment FROM players"),
    q("SELECT player_id,total_score,total_par,status FROM rounds WHERE status='APPROVED'"),
    q("SELECT best_x FROM settings WHERE id=1"),
  ]);
  res.json(computeRanking(players.rows, rounds.rows, settings.rows[0].best_x));
}));

// ---------------- ADMINS ----------------
app.get("/api/admins", authMiddleware, requireAdmin, wrap(async (_req, res) => {
  const r = await q("SELECT id,user_id,name,active,created_at FROM admins ORDER BY created_at");
  res.json(r.rows);
}));
app.post("/api/admins", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { name, userId, password, active } = req.body;
  if (!userId || !password) return res.status(400).json({ error: "User ID & password wajib" });
  const dup = await q(
    "SELECT 1 FROM admins WHERE lower(user_id)=$1 UNION SELECT 1 FROM players WHERE lower(user_id)=$1",
    [userId.toLowerCase()]);
  if (dup.rows.length) return res.status(409).json({ error: "User ID sudah dipakai" });
  const r = await q(
    "INSERT INTO admins (user_id,password_hash,name,active) VALUES ($1,$2,$3,$4) RETURNING id,user_id,name,active",
    [userId.toLowerCase(), await hash(password), name || "Admin", active !== false]);
  res.status(201).json(r.rows[0]);
}));
app.put("/api/admins/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  const { name, userId, password, active } = req.body;
  const params = [req.params.id, name, (userId || "").toLowerCase(), active !== false];
  let sql = "UPDATE admins SET name=$2, user_id=$3, active=$4";
  if (password) { sql += ", password_hash=$5"; params.push(await hash(password)); }
  sql += " WHERE id=$1 RETURNING id,user_id,name,active";
  const r = await q(sql, params);
  res.json(r.rows[0]);
}));
app.delete("/api/admins/:id", authMiddleware, requireAdmin, wrap(async (req, res) => {
  if (req.params.id === req.user.sub) return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri" });
  const act = await q("SELECT COUNT(*)::int n FROM admins WHERE active=true");
  if (act.rows[0].n <= 1) return res.status(400).json({ error: "Harus ada minimal satu admin aktif" });
  await q("DELETE FROM admins WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- OCR ----------------
app.post("/api/ocr/scorecard", authMiddleware, wrap(async (req, res) => {
  let { image, mediaType } = req.body;
  if (!image) return res.status(400).json({ error: "Tidak ada gambar" });
  const m = image.match(/^data:(image\/[a-z]+);base64,(.*)$/i);
  if (m) { mediaType = m[1]; image = m[2]; }
  const result = await ocrScorecard(image, mediaType || "image/jpeg");
  const photoUrl = saveImage(image, mediaType || "image/jpeg");
  res.json({ ...result, photoUrl });
}));

// ---------------- START ----------------
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await runSchema();
    await seedIfEmpty();
    app.listen(PORT, () => console.log(`PGPI backend jalan di port ${PORT}`));
  } catch (e) {
    console.error("Gagal start:", e); process.exit(1);
  }
})();
