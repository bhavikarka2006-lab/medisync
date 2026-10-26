CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','doctor','nurse','patient')),
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id),
  phone TEXT, blood_group TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id),
  department TEXT);
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  slot TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending -> confirmed (by Function) -> completed / cancelled
  reason TEXT, notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now());
-- DB-level guard against double booking (cancelled slots can be re-booked)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot ON appointments (doctor_id, slot) WHERE status <> 'cancelled';
CREATE TABLE IF NOT EXISTS beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'free');
CREATE TABLE IF NOT EXISTS admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  bed_id UUID NOT NULL REFERENCES beds(id),
  admitted_at TIMESTAMPTZ DEFAULT now(), discharged_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  kind TEXT, filename TEXT, blob_key TEXT NOT NULL, uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id UUID UNIQUE REFERENCES admissions(id),
  patient_id UUID REFERENCES patients(id),
  amount NUMERIC(10,2), blob_key TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS analytics_daily (
  day DATE PRIMARY KEY, appointments INT, admissions INT, occupancy_pct NUMERIC(5,2));
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(),
  actor TEXT, role TEXT, action TEXT, detail JSONB);
