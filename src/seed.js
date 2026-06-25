const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const { hash } = require("./auth");

const PAR = [4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4];
const sum = (a) => a.reduce((x, y) => x + y, 0);
function seeded(s){s%=2147483647;if(s<=0)s+=2147483646;return()=>(s=(s*16807)%2147483647)/2147483647;}
function genVector(par,total,seed){const v=par.slice();let d=total-sum(par);const r=seeded(seed);let g=0;
  while(d!==0&&g++<600){const i=Math.floor(r()*18);if(d>0){if(v[i]-par[i]<4){v[i]++;d--;}}else if(v[i]>1&&v[i]-par[i]>-1){v[i]--;d++;}}return v;}

const PLAYERS = [
  ["andi@pgpi.test","player123","Andi Pratama","PT Pupuk Kaltim","PT Pupuk Kaltim",true],
  ["budi@pgpi.test","player123","Budi Santoso","PT Petrokimia Gresik","PT Pupuk Indonesia (Holding)",true],
  ["rangga@pgpi.test","password123","Rangga Wijaya","PT Pupuk Iskandar Muda","PT Pupuk Indonesia (Holding)",true],
  ["hendra@pgpi.test","player123","Hendra Gunawan","PT Pupuk Sriwidjaja","PT Pupuk Sriwidjaja",true],
  ["dimas@pgpi.test","player123","Dimas Aryo","PT Pupuk Kujang","PT Pupuk Iskandar Muda",true],
  ["fajar@pgpi.test","player123","Fajar Nugroho","PT Pupuk Indonesia","PT Pupuk Indonesia",true],
  ["yusuf@pgpi.test","player123","Yusuf Maulana","PT Rekayasa Industri","PT Rekayasa Industri",true],
  ["bagas@pgpi.test","player123","Bagas Saputra","PT Pupuk Indonesia Pangan","PT Pupuk Indonesia (Holding)",true],
  ["wahyu@pgpi.test","player123","Wahyu Hidayat","PT Pupuk Indonesia Logistik","PT Pupuk Indonesia Logistik",false],
];
const COURSES = [
  ["Royale Jakarta Golf Club","Jakarta Timur",18,-6.2965,106.9012],
  ["Pondok Indah Golf Course","Jakarta Selatan",18,-6.2792,106.7841],
  ["Emeralda Golf Club","Cimanggis, Depok",27,-6.4180,106.8570],
  ["Damai Indah Golf — BSD","Tangerang",36,-6.2974,106.6525],
  ["Riverside Golf Club","Bogor",18,-6.4661,106.8401],
];
// ronde awal: [emailPemain, namaLapangan, tanggal, total, status]
const ROUNDS = [
  ["andi@pgpi.test","Royale Jakarta Golf Club","2026-05-03",79,"APPROVED"],
  ["andi@pgpi.test","Pondok Indah Golf Course","2026-05-10",81,"APPROVED"],
  ["andi@pgpi.test","Emeralda Golf Club","2026-05-17",82,"APPROVED"],
  ["andi@pgpi.test","Royale Jakarta Golf Club","2026-05-24",84,"APPROVED"],
  ["andi@pgpi.test","Damai Indah Golf — BSD","2026-06-07",85,"APPROVED"],
  ["andi@pgpi.test","Pondok Indah Golf Course","2026-06-14",86,"APPROVED"],
  ["budi@pgpi.test","Pondok Indah Golf Course","2026-05-03",80,"APPROVED"],
  ["budi@pgpi.test","Royale Jakarta Golf Club","2026-05-17",82,"APPROVED"],
  ["budi@pgpi.test","Damai Indah Golf — BSD","2026-05-24",83,"APPROVED"],
  ["budi@pgpi.test","Emeralda Golf Club","2026-06-07",85,"APPROVED"],
  ["rangga@pgpi.test","Royale Jakarta Golf Club","2026-05-10",81,"APPROVED"],
  ["rangga@pgpi.test","Damai Indah Golf — BSD","2026-05-24",83,"APPROVED"],
  ["rangga@pgpi.test","Pondok Indah Golf Course","2026-06-07",84,"APPROVED"],
  ["rangga@pgpi.test","Riverside Golf Club","2026-05-31",88,"REJECTED"],
  ["rangga@pgpi.test","Pondok Indah Golf Course","2026-06-22",82,"NEEDS_REVIEW"],
  ["dimas@pgpi.test","Royale Jakarta Golf Club","2026-06-22",86,"NEEDS_REVIEW"],
  ["bagas@pgpi.test","Emeralda Golf Club","2026-06-21",90,"NEEDS_REVIEW"],
];

async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await pool.query(sql);
}
async function seedIfEmpty() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM players");
  if (rows[0].n > 0) { console.log("Seed dilewati (data sudah ada)."); return; }
  console.log("Seeding data awal...");
  await pool.query(
    `INSERT INTO settings (id, season_name, best_x, geofence_km)
     VALUES (1,'PGPI League 2026',6,5) ON CONFLICT (id) DO NOTHING`);

  // admin pertama (dari env atau default)
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@pgpi.test";
  const adminPass  = process.env.SEED_ADMIN_PASSWORD || "admin123";
  await pool.query(
    `INSERT INTO admins (user_id, password_hash, name, active) VALUES ($1,$2,$3,true)
     ON CONFLICT (user_id) DO NOTHING`,
    [adminEmail.toLowerCase(), await hash(adminPass), "Panitia Liga"]);

  const courseId = {};
  for (const [name, city, holes, lat, lng] of COURSES) {
    const r = await pool.query(
      `INSERT INTO courses (name, city, holes, lat, lng) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, city, holes, lat, lng]);
    courseId[name] = r.rows[0].id;
  }
  const playerId = {};
  for (const [email, pw, name, unit, assign, active] of PLAYERS) {
    const r = await pool.query(
      `INSERT INTO players (user_id, password_hash, name, unit, assignment, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [email, await hash(pw), name, unit, assign, active]);
    playerId[email] = r.rows[0].id;
  }
  let i = 0;
  for (const [email, course, date, total, status] of ROUNDS) {
    const sv = genVector(PAR, total, total * 31 + i++);
    await pool.query(
      `INSERT INTO rounds (player_id, course_id, course_name, play_date, total_score, total_par,
         par_vector, score_vector, status, admin_note, distance_km, flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [playerId[email], courseId[course] || null, course, date, total, 72,
       JSON.stringify(PAR), JSON.stringify(sv), status,
       status === "NEEDS_REVIEW" ? "Menunggu pemeriksaan panitia." : null,
       1.2, JSON.stringify([])]);
  }
  console.log("Seeding selesai.");
}
module.exports = { runSchema, seedIfEmpty };
