const { Pool } = require("pg");
if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL belum di-set"); process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
  max: 10,
});
module.exports = { pool, q: (text, params) => pool.query(text, params) };
