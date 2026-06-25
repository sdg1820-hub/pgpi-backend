-- =====================================================================
--  PGPI League — Skema Database (PostgreSQL)
--  Dijalankan otomatis oleh backend saat pertama kali start.
--  Catatan: password TIDAK pernah disimpan apa adanya — kolomnya
--  menyimpan HASH (bcrypt). Backend yang melakukan hashing saat seeding.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- untuk gen_random_uuid()

-- ---------------------------------------------------------------------
-- Pengaturan musim (satu baris saja)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  id           SMALLINT PRIMARY KEY DEFAULT 1,
  season_name  TEXT      NOT NULL DEFAULT 'PGPI League 2026',
  best_x       SMALLINT  NOT NULL DEFAULT 6,        -- rata-rata dari X ronde terbaik
  geofence_km  NUMERIC(5,2) NOT NULL DEFAULT 5,     -- radius validasi lokasi
  CONSTRAINT settings_singleton CHECK (id = 1)
);

-- ---------------------------------------------------------------------
-- Akun panitia / admin  (bukan peserta liga)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT UNIQUE NOT NULL,               -- email untuk login
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Pemain  (akun login MENYATU dengan data pemain)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT UNIQUE NOT NULL,               -- email untuk login
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL,                       -- unit asal
  assignment    TEXT NOT NULL,                       -- penugasan saat ini
  active        BOOLEAN NOT NULL DEFAULT TRUE,       -- boleh login atau tidak
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Lapangan golf
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  city         TEXT NOT NULL,
  holes        SMALLINT NOT NULL DEFAULT 18,
  lat          NUMERIC(9,6),                         -- titik koordinat (geofence)
  lng          NUMERIC(9,6),
  par_template JSONB NOT NULL DEFAULT '[4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Status ronde
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE round_status AS ENUM ('NEEDS_REVIEW','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Ronde (hasil submit pemain)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rounds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  course_id     UUID REFERENCES courses(id) ON DELETE SET NULL,
  course_name   TEXT NOT NULL,                        -- snapshot nama lapangan
  play_date     DATE NOT NULL,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_score   SMALLINT NOT NULL,
  total_par     SMALLINT NOT NULL,
  par_vector    JSONB NOT NULL,                       -- 18 angka par per-hole
  score_vector  JSONB NOT NULL,                       -- 18 angka skor per-hole
  status        round_status NOT NULL DEFAULT 'NEEDS_REVIEW',
  admin_note    TEXT,
  distance_km   NUMERIC(6,2),                         -- jarak GPS dari lapangan
  flags         JSONB NOT NULL DEFAULT '[]',          -- mis. ["over_radius","ocr_low_confidence"]
  photo_url     TEXT,                                 -- lokasi foto scorecard
  ocr_raw       JSONB,                                -- hasil mentah OCR (untuk audit)
  reviewed_by   UUID REFERENCES admins(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rounds_player   ON rounds(player_id);
CREATE INDEX IF NOT EXISTS idx_rounds_status   ON rounds(status);
CREATE INDEX IF NOT EXISTS idx_rounds_playdate ON rounds(play_date);

-- =====================================================================
--  Seeding (admin pertama, pemain, lapangan, settings) dilakukan oleh
--  backend agar password bisa di-hash. Lihat langkah berikutnya.
-- =====================================================================
