const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const SECRET = process.env.JWT_SECRET || "ganti-secret-ini";
const EXPIRES = "30d";

const hash = (pw) => bcrypt.hash(pw, 10);
const verify = (pw, h) => bcrypt.compare(pw, h);
const sign = (payload) => jwt.sign(payload, SECRET, { expiresIn: EXPIRES });

function authMiddleware(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Tidak ada token" });
  try {
    req.user = jwt.verify(token, SECRET); // {sub, role, name, userId}
    next();
  } catch {
    res.status(401).json({ error: "Token tidak valid / kedaluwarsa" });
  }
}
const requireAdmin = (req, res, next) =>
  req.user && req.user.role === "admin" ? next() : res.status(403).json({ error: "Khusus admin" });

module.exports = { hash, verify, sign, authMiddleware, requireAdmin };
