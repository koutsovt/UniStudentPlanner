-- Unistudent PoC schema (SQLite)
-- Single-student PoC; RLS/multi-tenant omitted per scope.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS student (
  id            INTEGER PRIMARY KEY,
  student_id    TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  program_code  TEXT NOT NULL,
  intake_period TEXT NOT NULL,
  year_level    INTEGER NOT NULL,
  is_international INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS course (
  code                TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  total_credit_points INTEGER NOT NULL,
  duration_years_ft   REAL NOT NULL,
  handbook_url        TEXT
);

CREATE TABLE IF NOT EXISTS component (
  id           INTEGER PRIMARY KEY,
  course_code  TEXT NOT NULL REFERENCES course(code),
  type         TEXT NOT NULL CHECK(type IN ('core','major','minor','specialisation','elective')),
  title        TEXT NOT NULL,
  credit_points INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS subject (
  code          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  credit_points INTEGER NOT NULL,
  description   TEXT,
  handbook_url  TEXT
);

CREATE TABLE IF NOT EXISTS component_subject (
  component_id INTEGER NOT NULL REFERENCES component(id),
  subject_code TEXT NOT NULL REFERENCES subject(code),
  PRIMARY KEY (component_id, subject_code)
);

CREATE TABLE IF NOT EXISTS subject_requisite (
  subject_code    TEXT NOT NULL REFERENCES subject(code),
  requires_code   TEXT NOT NULL REFERENCES subject(code),
  kind            TEXT NOT NULL CHECK(kind IN ('prerequisite','corequisite','incompatible','equivalent')),
  PRIMARY KEY (subject_code, requires_code, kind)
);

CREATE TABLE IF NOT EXISTS teaching_period (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  year        INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK(status IN ('past','current','future')),
  start_date  TEXT,
  end_date    TEXT
);

CREATE TABLE IF NOT EXISTS subject_offering (
  subject_code        TEXT NOT NULL REFERENCES subject(code),
  teaching_period     TEXT NOT NULL REFERENCES teaching_period(code),
  delivery_mode       TEXT NOT NULL,
  campus              TEXT NOT NULL,
  PRIMARY KEY (subject_code, teaching_period, delivery_mode, campus)
);

CREATE TABLE IF NOT EXISTS student_plan_entry (
  id              INTEGER PRIMARY KEY,
  student_id      INTEGER NOT NULL REFERENCES student(id),
  subject_code    TEXT NOT NULL REFERENCES subject(code),
  teaching_period TEXT NOT NULL REFERENCES teaching_period(code),
  status          TEXT NOT NULL CHECK(status IN ('completed','enrolled','planned','credited')),
  grade           TEXT,
  UNIQUE(student_id, subject_code)
);

CREATE TABLE IF NOT EXISTS student_component (
  student_id   INTEGER NOT NULL REFERENCES student(id),
  component_id INTEGER NOT NULL REFERENCES component(id),
  PRIMARY KEY (student_id, component_id)
);

CREATE TABLE IF NOT EXISTS timetable_session (
  id              INTEGER PRIMARY KEY,
  subject_code    TEXT NOT NULL REFERENCES subject(code),
  teaching_period TEXT NOT NULL REFERENCES teaching_period(code),
  activity_type   TEXT NOT NULL CHECK(activity_type IN ('Lecture','Tutorial','Workshop','Lab','Seminar')),
  day_of_week     INTEGER NOT NULL,
  start_time      TEXT NOT NULL,
  duration_min    INTEGER NOT NULL,
  location        TEXT NOT NULL,
  delivery_mode   TEXT NOT NULL,
  section_code    TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reminder (
  id           INTEGER PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES student(id),
  title        TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK(kind IN ('assessment','study','enrolment','advisor','other')),
  subject_code TEXT REFERENCES subject(code),
  done         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_thread (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id),
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS conversation_message (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id),
  thread_id  INTEGER NOT NULL REFERENCES conversation_thread(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_fact (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES student(id),
  category   TEXT NOT NULL CHECK(category IN ('preference','context','goal','schedule','topic','other')),
  body       TEXT NOT NULL,
  source     TEXT NOT NULL CHECK(source IN ('remember','extracted')),
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nudge_dismissal (
  id           INTEGER PRIMARY KEY,
  student_id   INTEGER NOT NULL REFERENCES student(id),
  nudge_key    TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, nudge_key)
);

CREATE TABLE IF NOT EXISTS assessment (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES student(id),
  subject_code  TEXT NOT NULL REFERENCES subject(code),
  title         TEXT NOT NULL,
  weight_pct    REAL NOT NULL,
  due_at        TEXT,
  score_pct     REAL,
  reminder_id   INTEGER REFERENCES reminder(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plan_student ON student_plan_entry(student_id);
CREATE INDEX IF NOT EXISTS idx_plan_period ON student_plan_entry(teaching_period);
CREATE INDEX IF NOT EXISTS idx_reminder_due ON reminder(student_id, due_at);
CREATE INDEX IF NOT EXISTS idx_thread_student ON conversation_thread(student_id, archived);
CREATE INDEX IF NOT EXISTS idx_message_thread ON conversation_message(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_fact_student ON student_fact(student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_student ON assessment(student_id, subject_code);
