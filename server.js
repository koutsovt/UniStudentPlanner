import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import Database from 'better-sqlite3';
import { OpenRouter } from '@openrouter/sdk';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clearAllData, insertSeedData } from './db/seed.js';

const llmClient = process.env.OPENROUTER_API_KEY
  ? new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      httpReferer: 'http://localhost:3000',
      appTitle: 'Unistudent PoC',
    })
  : null;
const llmModel = process.env.UNISTUDENT_LLM_MODEL ?? 'z-ai/glm-4.7';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'db', 'data.sqlite'));
db.pragma('foreign_keys = ON');

const app = Fastify({ logger: { level: 'info' } });

app.decorate('db', db);
app.decorate('currentStudent', () => db.prepare('SELECT * FROM student LIMIT 1').get());

await app.register(fastifyStatic, { root: join(__dirname, 'ui'), prefix: '/' });

// ----- Student -----
app.get('/api/student', async () => {
  const s = app.currentStudent();
  const components = db.prepare(`
    SELECT c.* FROM component c
    JOIN student_component sc ON sc.component_id = c.id
    WHERE sc.student_id = ?`).all(s.id);
  return { ...s, components };
});

// ----- Dashboard summary -----
app.get('/api/dashboard', async () => {
  const s = app.currentStudent();
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status='completed' THEN sub.credit_points ELSE 0 END) AS completed,
      SUM(CASE WHEN status='enrolled'  THEN sub.credit_points ELSE 0 END) AS enrolled,
      SUM(CASE WHEN status='planned'   THEN sub.credit_points ELSE 0 END) AS planned
    FROM student_plan_entry p
    JOIN subject sub ON sub.code = p.subject_code
    WHERE p.student_id = ?`).get(s.id);
  const course = db.prepare('SELECT * FROM course WHERE code = ?').get(s.program_code);
  const upcoming = db.prepare(`
    SELECT * FROM reminder WHERE student_id = ? AND done = 0
    ORDER BY due_at ASC LIMIT 5`).all(s.id);
  const today = new Date().getDay();
  const currentPeriod = db.prepare(`SELECT code FROM teaching_period WHERE status='current' LIMIT 1`).get();
  const todayClasses = currentPeriod ? db.prepare(`
    SELECT ts.*, s.title FROM timetable_session ts
    JOIN subject s ON s.code = ts.subject_code
    WHERE ts.teaching_period = ? AND ts.day_of_week = ? AND ts.is_active = 1
    ORDER BY ts.start_time`).all(currentPeriod.code, today) : [];
  const gpaRow = db.prepare(`
    SELECT AVG(CASE grade
      WHEN 'HD' THEN 4.0 WHEN 'D' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'P' THEN 1.0 ELSE NULL END) AS gpa
    FROM student_plan_entry WHERE student_id = ? AND status='completed'`).get(s.id);
  return {
    course,
    credits: {
      completed: totals.completed ?? 0,
      enrolled:  totals.enrolled  ?? 0,
      planned:   totals.planned   ?? 0,
      total:     course.total_credit_points,
    },
    upcoming,
    todayClasses,
    gpa: gpaRow.gpa ? Number(gpaRow.gpa.toFixed(2)) : null,
  };
});

// ----- Planner -----
app.get('/api/planner', async () => {
  const s = app.currentStudent();
  const periods = db.prepare('SELECT * FROM teaching_period ORDER BY sort_order').all();
  const plan = db.prepare(`
    SELECT p.*, s.title, s.credit_points,
           c.type AS component_type, c.title AS component_title
    FROM student_plan_entry p
    JOIN subject s ON s.code = p.subject_code
    LEFT JOIN component_subject cs ON cs.subject_code = s.code
    LEFT JOIN component c ON c.id = cs.component_id
    LEFT JOIN student_component sc ON sc.component_id = c.id AND sc.student_id = ?
    WHERE p.student_id = ?
    GROUP BY p.id`).all(s.id, s.id);

  // Subjects available to add (in student's components, not already planned)
  const available = db.prepare(`
    SELECT DISTINCT s.code, s.title, s.credit_points, c.type AS component_type, c.title AS component_title
    FROM subject s
    JOIN component_subject cs ON cs.subject_code = s.code
    JOIN component c ON c.id = cs.component_id
    JOIN student_component sc ON sc.component_id = c.id AND sc.student_id = ?
    WHERE s.code NOT IN (SELECT subject_code FROM student_plan_entry WHERE student_id = ?)
    ORDER BY c.type, s.code`).all(s.id, s.id);

  return { periods, plan, available };
});

// Move or add a subject to a teaching period
app.post('/api/planner/entry', async (req, reply) => {
  const s = app.currentStudent();
  const { subject_code, teaching_period } = req.body ?? {};
  if (!subject_code || !teaching_period) {
    return reply.code(400).send({ error: 'subject_code and teaching_period required' });
  }
  const period = db.prepare('SELECT * FROM teaching_period WHERE code = ?').get(teaching_period);
  if (!period) return reply.code(404).send({ error: 'Unknown teaching period' });
  if (period.status === 'past') {
    return reply.code(400).send({ error: 'Cannot add subjects to past teaching periods (BR03-02)' });
  }
  const subject = db.prepare('SELECT * FROM subject WHERE code = ?').get(subject_code);
  if (!subject) return reply.code(404).send({ error: 'Unknown subject' });

  const existing = db.prepare(`SELECT * FROM student_plan_entry
    WHERE student_id = ? AND subject_code = ?`).get(s.id, subject_code);

  if (existing) {
    if (existing.status === 'completed' || existing.status === 'enrolled') {
      return reply.code(400).send({ error: `Cannot move a ${existing.status} subject` });
    }
    db.prepare(`UPDATE student_plan_entry SET teaching_period = ? WHERE id = ?`)
      .run(teaching_period, existing.id);
  } else {
    db.prepare(`INSERT INTO student_plan_entry
      (student_id, subject_code, teaching_period, status) VALUES (?,?,?, 'planned')`)
      .run(s.id, subject_code, teaching_period);
  }
  return { ok: true };
});

// Remove a planned subject
app.delete('/api/planner/entry/:code', async (req, reply) => {
  const s = app.currentStudent();
  const row = db.prepare(`SELECT * FROM student_plan_entry
    WHERE student_id = ? AND subject_code = ?`).get(s.id, req.params.code);
  if (!row) return reply.code(404).send({ error: 'Not found' });
  if (row.status !== 'planned') {
    return reply.code(400).send({ error: `Cannot remove a ${row.status} subject` });
  }
  db.prepare('DELETE FROM student_plan_entry WHERE id = ?').run(row.id);
  return { ok: true };
});

// Detect pairwise timetable clashes for the student's enrolled subjects in the current period.
// Returns { period, sessions, clashes: [{a, b}] } — a and b are session ids.
function detectClashes(studentId) {
  const period = db.prepare(`SELECT * FROM teaching_period WHERE status='current' LIMIT 1`).get();
  if (!period) return { period: null, sessions: [], clashes: [] };
  const sessions = db.prepare(`
    SELECT ts.*, s.title
    FROM timetable_session ts
    JOIN subject s ON s.code = ts.subject_code
    WHERE ts.teaching_period = ?
      AND ts.is_active = 1
      AND ts.subject_code IN (
        SELECT subject_code FROM student_plan_entry
        WHERE student_id = ? AND status = 'enrolled'
      )
    ORDER BY ts.day_of_week, ts.start_time`).all(period.code, studentId);
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const clashes = [];
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i], b = sessions[j];
      if (a.day_of_week !== b.day_of_week) continue;
      const aStart = toMin(a.start_time), aEnd = aStart + a.duration_min;
      const bStart = toMin(b.start_time), bEnd = bStart + b.duration_min;
      if (aStart < bEnd && bStart < aEnd) clashes.push({ a: a.id, b: b.id });
    }
  }
  return { period, sessions, clashes };
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function describeSession(s) {
  return `${s.subject_code} ${s.activity_type} (${DAY_SHORT[s.day_of_week]} ${s.start_time}, ${s.location})`;
}

// Validate plan — prerequisites, credit caps, timetable clashes
function validatePlan(studentId) {
  const entries = db.prepare(`
    SELECT p.*, tp.sort_order, tp.status AS period_status, tp.label AS period_label
    FROM student_plan_entry p
    JOIN teaching_period tp ON tp.code = p.teaching_period
    WHERE p.student_id = ?`).all(studentId);

  const requisites = db.prepare('SELECT * FROM subject_requisite').all();
  const bySubject = Object.create(null);
  for (const r of requisites) (bySubject[r.subject_code] ??= []).push(r);
  const orderBy = Object.create(null);
  for (const e of entries) orderBy[e.subject_code] = e.sort_order;

  const issues = [];
  for (const e of entries) {
    if (e.status === 'credited') continue;
    const reqs = bySubject[e.subject_code] ?? [];
    for (const r of reqs.filter(x => x.kind === 'prerequisite')) {
      const preOrder = orderBy[r.requires_code];
      if (preOrder === undefined) {
        issues.push({ severity: 'error', subject_code: e.subject_code, period: e.teaching_period,
          message: `Missing prerequisite ${r.requires_code}` });
      } else if (preOrder >= e.sort_order) {
        issues.push({ severity: 'error', subject_code: e.subject_code, period: e.teaching_period,
          message: `Prerequisite ${r.requires_code} must be completed before this subject` });
      }
    }
  }
  const perPeriod = db.prepare(`
    SELECT p.teaching_period, tp.label, tp.status AS period_status,
           SUM(s.credit_points) AS total, COUNT(*) AS n
    FROM student_plan_entry p
    JOIN subject s ON s.code = p.subject_code
    JOIN teaching_period tp ON tp.code = p.teaching_period
    WHERE p.student_id = ? AND tp.status != 'past'
    GROUP BY p.teaching_period`).all(studentId);
  for (const row of perPeriod) {
    if (row.total > 60) {
      issues.push({
        severity: 'warning', period: row.teaching_period,
        message: `${row.label} exceeds standard full-time load (${row.total}/60 CP)`,
      });
    }
  }
  // Timetable clashes — only for currently-enrolled subjects
  const { period: clashPeriod, sessions, clashes } = detectClashes(studentId);
  if (clashPeriod && clashes.length) {
    const byId = Object.create(null);
    for (const s of sessions) byId[s.id] = s;
    for (const c of clashes) {
      const a = byId[c.a], b = byId[c.b];
      issues.push({
        severity: 'warning', kind: 'clash',
        period: clashPeriod.code,
        subject_code: `${a.subject_code} / ${b.subject_code}`,
        session_a: c.a, session_b: c.b,
        message: `${describeSession(a)} overlaps with ${describeSession(b)}`,
      });
    }
  }
  return { issues };
}

app.get('/api/planner/validate', async () => {
  const s = app.currentStudent();
  return validatePlan(s.id);
});

// Forecast final mark for a subject from scored/unscored assessments.
// expected extrapolates the current rate to remaining weight; falls back to 70 if nothing is scored yet.
function computeForecast(studentId, subjectCode) {
  const rows = db.prepare(`SELECT weight_pct, score_pct FROM assessment
    WHERE student_id = ? AND subject_code = ?`).all(studentId, subjectCode);
  if (!rows.length) return null;
  let earned = 0, committed = 0, remaining = 0, totalWeight = 0;
  for (const r of rows) {
    totalWeight += r.weight_pct;
    if (r.score_pct == null) remaining += r.weight_pct;
    else {
      committed += r.weight_pct;
      earned += r.weight_pct * r.score_pct / 100;
    }
  }
  const rate = committed > 0 ? earned / committed : 0.70;
  const round1 = n => Math.round(n * 10) / 10;
  const scenarios = {
    best:     round1(earned + remaining * 1.00),
    expected: round1(earned + remaining * rate),
    worst:    round1(earned + remaining * 0.50),
  };
  const letter = m =>
    m >= 80 ? 'HD' : m >= 70 ? 'D' : m >= 60 ? 'C' : m >= 50 ? 'P' : 'F';
  return {
    earned_pct: round1(earned),
    committed_weight: round1(committed),
    remaining_weight: round1(remaining),
    total_weight: round1(totalWeight),
    scenarios,
    letter_forecast: letter(scenarios.expected),
    weight_warning: Math.abs(totalWeight - 100) > 0.01
      ? `Weights sum to ${round1(totalWeight)}% (expected 100%)`
      : null,
  };
}

// ----- Assessments -----
app.get('/api/assessments', async (req) => {
  const s = app.currentStudent();
  const sc = (req.query?.subject_code ?? '').toString().toUpperCase();
  const rows = sc
    ? db.prepare(`SELECT * FROM assessment WHERE student_id = ? AND subject_code = ?
        ORDER BY due_at IS NULL, due_at, id`).all(s.id, sc)
    : db.prepare(`SELECT * FROM assessment WHERE student_id = ?
        ORDER BY subject_code, due_at IS NULL, due_at, id`).all(s.id);
  return rows;
});

function subjectInPlan(studentId, subjectCode) {
  return db.prepare(`SELECT 1 FROM student_plan_entry
    WHERE student_id = ? AND subject_code = ? LIMIT 1`).get(studentId, subjectCode);
}

app.post('/api/assessments', async (req, reply) => {
  const s = app.currentStudent();
  const b = req.body ?? {};
  const subject_code = (b.subject_code ?? '').toString().toUpperCase();
  const title = (b.title ?? '').toString().trim();
  const weight_pct = Number(b.weight_pct);
  const due_at = b.due_at ? String(b.due_at) : null;
  const score_pct = b.score_pct == null || b.score_pct === '' ? null : Number(b.score_pct);
  if (!subject_code || !title || !Number.isFinite(weight_pct)) {
    return reply.code(400).send({ error: 'subject_code, title, weight_pct required' });
  }
  if (weight_pct < 0 || weight_pct > 100) {
    return reply.code(400).send({ error: 'weight_pct must be between 0 and 100' });
  }
  if (score_pct != null && (score_pct < 0 || score_pct > 100)) {
    return reply.code(400).send({ error: 'score_pct must be between 0 and 100' });
  }
  if (!db.prepare('SELECT 1 FROM subject WHERE code = ?').get(subject_code)) {
    return reply.code(404).send({ error: 'Unknown subject' });
  }
  if (!subjectInPlan(s.id, subject_code)) {
    return reply.code(400).send({ error: `${subject_code} is not in your plan` });
  }
  let reminder_id = null;
  if (due_at && score_pct == null) {
    const info = db.prepare(`INSERT INTO reminder
      (student_id,title,due_at,kind,subject_code) VALUES (?,?,?,?,?)`)
      .run(s.id, `${subject_code} — ${title}`, due_at, 'assessment', subject_code);
    reminder_id = info.lastInsertRowid;
  }
  const info = db.prepare(`INSERT INTO assessment
    (student_id, subject_code, title, weight_pct, due_at, score_pct, reminder_id)
    VALUES (?,?,?,?,?,?,?)`).run(s.id, subject_code, title, weight_pct, due_at, score_pct, reminder_id);
  return { id: info.lastInsertRowid, reminder_id };
});

app.patch('/api/assessments/:id', async (req, reply) => {
  const s = app.currentStudent();
  const existing = db.prepare(`SELECT * FROM assessment WHERE id = ? AND student_id = ?`)
    .get(req.params.id, s.id);
  if (!existing) return reply.code(404).send({ error: 'Not found' });

  const b = req.body ?? {};
  const fields = [];
  const values = [];
  const hasTitle = b.title !== undefined;
  const hasWeight = b.weight_pct !== undefined;
  const hasDue = b.due_at !== undefined;
  const hasScore = b.score_pct !== undefined;

  if (hasTitle) {
    const t = String(b.title).trim();
    if (!t) return reply.code(400).send({ error: 'title cannot be empty' });
    fields.push('title = ?'); values.push(t);
  }
  if (hasWeight) {
    const w = Number(b.weight_pct);
    if (!Number.isFinite(w) || w < 0 || w > 100)
      return reply.code(400).send({ error: 'weight_pct must be between 0 and 100' });
    fields.push('weight_pct = ?'); values.push(w);
  }
  if (hasDue) {
    fields.push('due_at = ?'); values.push(b.due_at ? String(b.due_at) : null);
  }
  if (hasScore) {
    const sc = b.score_pct == null || b.score_pct === '' ? null : Number(b.score_pct);
    if (sc != null && (!Number.isFinite(sc) || sc < 0 || sc > 100))
      return reply.code(400).send({ error: 'score_pct must be between 0 and 100' });
    fields.push('score_pct = ?'); values.push(sc);
  }
  if (!fields.length) return reply.code(400).send({ error: 'No fields to update' });
  values.push(existing.id, s.id);
  db.prepare(`UPDATE assessment SET ${fields.join(', ')} WHERE id = ? AND student_id = ?`).run(...values);

  // Keep the linked reminder in sync.
  if (existing.reminder_id) {
    const newTitle = hasTitle ? String(b.title).trim() : existing.title;
    const newDue = hasDue ? (b.due_at ? String(b.due_at) : null) : existing.due_at;
    const newScore = hasScore
      ? (b.score_pct == null || b.score_pct === '' ? null : Number(b.score_pct))
      : existing.score_pct;
    // If a score was entered, mark reminder done. If the due date or title changed, update them.
    if (newScore != null && existing.score_pct == null) {
      db.prepare('UPDATE reminder SET done = 1 WHERE id = ? AND student_id = ?')
        .run(existing.reminder_id, s.id);
    }
    if ((hasTitle || hasDue) && newDue) {
      db.prepare(`UPDATE reminder SET title = ?, due_at = ? WHERE id = ? AND student_id = ?`)
        .run(`${existing.subject_code} — ${newTitle}`, newDue, existing.reminder_id, s.id);
    }
  }
  return { ok: true };
});

app.delete('/api/assessments/:id', async (req, reply) => {
  const s = app.currentStudent();
  const existing = db.prepare(`SELECT * FROM assessment WHERE id = ? AND student_id = ?`)
    .get(req.params.id, s.id);
  if (!existing) return reply.code(404).send({ error: 'Not found' });
  db.prepare('DELETE FROM assessment WHERE id = ? AND student_id = ?').run(existing.id, s.id);
  if (existing.reminder_id) {
    db.prepare('DELETE FROM reminder WHERE id = ? AND student_id = ?').run(existing.reminder_id, s.id);
  }
  return { ok: true };
});

app.get('/api/assessments/forecast/:subject_code', async (req, reply) => {
  const s = app.currentStudent();
  const code = req.params.subject_code.toUpperCase();
  const forecast = computeForecast(s.id, code);
  if (!forecast) return reply.code(404).send({ error: `No assessments for ${code}` });
  return { subject_code: code, ...forecast };
});

// ----- Timetable -----
app.get('/api/timetable', async () => {
  const s = app.currentStudent();
  return detectClashes(s.id);
});

// Alternates for a given active session (for the clash-resolve UI).
app.get('/api/timetable/alternates/:session_id', async (req, reply) => {
  const s = app.currentStudent();
  const session = db.prepare(`SELECT * FROM timetable_session WHERE id = ?`).get(req.params.session_id);
  if (!session) return reply.code(404).send({ error: 'Session not found' });
  if (!session.is_active) return reply.code(400).send({ error: 'Session is not active' });
  if (!subjectInPlan(s.id, session.subject_code)) {
    return reply.code(400).send({ error: `${session.subject_code} is not in your plan` });
  }
  const options = findAlternateSections(s.id, session.subject_code, session.activity_type, session.teaching_period, session.id);
  return {
    session,
    clean: options.filter(o => !o.blocker).map(o => o.alt),
    blocked: options.map(o => o.blocker ? ({ ...o.alt, blocker: o.blocker }) : null).filter(Boolean),
  };
});

// Swap an active session for an alternate (flips is_active on both).
app.post('/api/timetable/swap', async (req, reply) => {
  const s = app.currentStudent();
  const { from_session_id, to_session_id } = req.body ?? {};
  if (!from_session_id || !to_session_id) {
    return reply.code(400).send({ error: 'from_session_id and to_session_id required' });
  }
  const from = db.prepare(`SELECT * FROM timetable_session WHERE id = ?`).get(from_session_id);
  const to   = db.prepare(`SELECT * FROM timetable_session WHERE id = ?`).get(to_session_id);
  if (!from || !to) return reply.code(404).send({ error: 'Session not found' });
  if (from.teaching_period !== to.teaching_period)
    return reply.code(400).send({ error: 'Sessions are in different teaching periods' });
  if (from.subject_code !== to.subject_code || from.activity_type !== to.activity_type)
    return reply.code(400).send({ error: 'Sessions must be same subject and activity type' });
  if (from.is_active !== 1 || to.is_active !== 0)
    return reply.code(400).send({ error: 'from must be active and to must be inactive' });
  if (!subjectInPlan(s.id, from.subject_code))
    return reply.code(400).send({ error: `${from.subject_code} is not in your plan` });

  const swap = db.transaction(() => {
    db.prepare('UPDATE timetable_session SET is_active = 0 WHERE id = ?').run(from.id);
    db.prepare('UPDATE timetable_session SET is_active = 1 WHERE id = ?').run(to.id);
  });
  swap();
  return { ok: true, activated: to.id, deactivated: from.id };
});

// ----- Progress -----
app.get('/api/progress', async () => {
  const s = app.currentStudent();
  const components = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status = 'completed'), 0) AS completed_cp,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status IN ('enrolled','planned')), 0) AS in_progress_cp
    FROM component c
    JOIN student_component sc ON sc.component_id = c.id AND sc.student_id = ?
    ORDER BY CASE c.type WHEN 'core' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END`).all(s.id, s.id, s.id);

  const grades = db.prepare(`
    SELECT p.teaching_period, tp.label, tp.sort_order,
           AVG(CASE p.grade
             WHEN 'HD' THEN 4.0 WHEN 'D' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'P' THEN 1.0 ELSE NULL END) AS gpa,
           COUNT(*) AS n
    FROM student_plan_entry p
    JOIN teaching_period tp ON tp.code = p.teaching_period
    WHERE p.student_id = ? AND p.status='completed'
    GROUP BY p.teaching_period ORDER BY tp.sort_order`).all(s.id);
  return { components, grades };
});

// ----- Reminders -----
app.get('/api/reminders', async () => {
  const s = app.currentStudent();
  return db.prepare(`SELECT * FROM reminder WHERE student_id = ?
    ORDER BY done ASC, due_at ASC`).all(s.id);
});

app.post('/api/reminders', async (req, reply) => {
  const s = app.currentStudent();
  const { title, due_at, kind = 'other', subject_code = null } = req.body ?? {};
  if (!title || !due_at) return reply.code(400).send({ error: 'title and due_at required' });
  const info = db.prepare(`INSERT INTO reminder
    (student_id,title,due_at,kind,subject_code) VALUES (?,?,?,?,?)`)
    .run(s.id, title, due_at, kind, subject_code);
  return { id: info.lastInsertRowid };
});

app.patch('/api/reminders/:id', async (req, reply) => {
  const s = app.currentStudent();
  const { done } = req.body ?? {};
  const r = db.prepare('UPDATE reminder SET done = ? WHERE id = ? AND student_id = ?')
    .run(done ? 1 : 0, req.params.id, s.id);
  if (r.changes === 0) return reply.code(404).send({ error: 'Not found' });
  return { ok: true };
});

app.delete('/api/reminders/:id', async (req, reply) => {
  const s = app.currentStudent();
  const r = db.prepare('DELETE FROM reminder WHERE id = ? AND student_id = ?')
    .run(req.params.id, s.id);
  if (r.changes === 0) return reply.code(404).send({ error: 'Not found' });
  return { ok: true };
});

// ----- Calendar export (ICS) -----
function icsEscape(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function pad2(n) { return String(n).padStart(2, '0'); }
function toICSLocal(d) {
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function toICSUtc(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth()+1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}
function parseLocalIso(iso) {
  // Accepts "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM[:SS]" — treated as local wall-clock.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]),
    Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}
function firstOccurrence(periodStartISO, dayOfWeek, startTime) {
  const start = parseLocalIso(periodStartISO);
  const [h, m] = startTime.split(':').map(Number);
  const out = new Date(start);
  const delta = (dayOfWeek - out.getDay() + 7) % 7;
  out.setDate(out.getDate() + delta);
  out.setHours(h, m, 0, 0);
  return out;
}

app.get('/api/calendar.ics', async (req, reply) => {
  const s = app.currentStudent();
  const tz = 'Australia/Melbourne';
  const now = new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Unistudent PoC//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  // Weekly class sessions in the current teaching period
  const period = db.prepare(`SELECT * FROM teaching_period WHERE status='current' LIMIT 1`).get();
  if (period && period.start_date && period.end_date) {
    const sessions = db.prepare(`
      SELECT ts.*, sub.title FROM timetable_session ts
      JOIN subject sub ON sub.code = ts.subject_code
      WHERE ts.teaching_period = ?
        AND ts.is_active = 1
        AND ts.subject_code IN (
          SELECT subject_code FROM student_plan_entry
          WHERE student_id = ? AND status = 'enrolled'
        )`).all(period.code, s.id);
    const periodEnd = parseLocalIso(period.end_date);
    periodEnd.setHours(23, 59, 59, 0);
    for (const ses of sessions) {
      const dtStart = firstOccurrence(period.start_date, ses.day_of_week, ses.start_time);
      if (dtStart > periodEnd) continue;
      const dtEnd = new Date(dtStart.getTime() + ses.duration_min * 60000);
      lines.push(
        'BEGIN:VEVENT',
        `UID:session-${ses.id}@unistudent`,
        `DTSTAMP:${toICSUtc(now)}`,
        `DTSTART;TZID=${tz}:${toICSLocal(dtStart)}`,
        `DTEND;TZID=${tz}:${toICSLocal(dtEnd)}`,
        `RRULE:FREQ=WEEKLY;UNTIL=${toICSUtc(periodEnd)}`,
        `SUMMARY:${icsEscape(`${ses.subject_code} ${ses.activity_type} — ${ses.title}`)}`,
        `LOCATION:${icsEscape(ses.location)}`,
        `DESCRIPTION:${icsEscape(`Delivery: ${ses.delivery_mode}`)}`,
        'END:VEVENT',
      );
    }
  }

  // Reminders (all open, any kind)
  const reminders = db.prepare(`SELECT * FROM reminder WHERE student_id = ? AND done = 0
    ORDER BY due_at ASC`).all(s.id);
  for (const r of reminders) {
    const due = parseLocalIso(r.due_at);
    const end = new Date(due.getTime() + 30 * 60000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:reminder-${r.id}@unistudent`,
      `DTSTAMP:${toICSUtc(now)}`,
      `DTSTART;TZID=${tz}:${toICSLocal(due)}`,
      `DTEND;TZID=${tz}:${toICSLocal(end)}`,
      `SUMMARY:${icsEscape(r.title)}`,
      `CATEGORIES:${icsEscape(r.kind)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  reply
    .header('Content-Type', 'text/calendar; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="unistudent.ics"')
    .send(lines.join('\r\n') + '\r\n');
});

// ----- Threads -----
function defaultThreadFor(studentId) {
  let t = db.prepare(`SELECT * FROM conversation_thread WHERE student_id = ? AND archived = 0
    ORDER BY id ASC LIMIT 1`).get(studentId);
  if (!t) {
    const info = db.prepare(`INSERT INTO conversation_thread (student_id,title) VALUES (?, 'Inbox')`).run(studentId);
    t = { id: info.lastInsertRowid, student_id: studentId, title: 'Inbox', archived: 0 };
  }
  return t;
}
function resolveThreadId(studentId, requestedId) {
  if (requestedId) {
    const t = db.prepare('SELECT id FROM conversation_thread WHERE id = ? AND student_id = ?').get(requestedId, studentId);
    if (t) return t.id;
  }
  return defaultThreadFor(studentId).id;
}

app.get('/api/agent/threads', async () => {
  const s = app.currentStudent();
  defaultThreadFor(s.id); // ensure at least one
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM conversation_message m WHERE m.thread_id = t.id) AS message_count,
      (SELECT MAX(id) FROM conversation_message m WHERE m.thread_id = t.id) AS last_message_id
    FROM conversation_thread t
    WHERE t.student_id = ?
    ORDER BY t.archived ASC, last_message_id DESC NULLS LAST, t.id ASC`).all(s.id);
});

app.post('/api/agent/threads', async (req, reply) => {
  const s = app.currentStudent();
  const title = (req.body?.title ?? '').trim() || 'New thread';
  const info = db.prepare(`INSERT INTO conversation_thread (student_id,title) VALUES (?,?)`).run(s.id, title);
  return { id: info.lastInsertRowid, title };
});

app.patch('/api/agent/threads/:id', async (req, reply) => {
  const s = app.currentStudent();
  const fields = [];
  const values = [];
  if (req.body?.title !== undefined) { fields.push('title = ?'); values.push(String(req.body.title).trim() || 'Untitled'); }
  if (req.body?.archived !== undefined) { fields.push('archived = ?'); values.push(req.body.archived ? 1 : 0); }
  if (!fields.length) return reply.code(400).send({ error: 'No fields to update' });
  values.push(req.params.id, s.id);
  const r = db.prepare(`UPDATE conversation_thread SET ${fields.join(', ')} WHERE id = ? AND student_id = ?`).run(...values);
  if (r.changes === 0) return reply.code(404).send({ error: 'Thread not found' });
  return { ok: true };
});

app.delete('/api/agent/threads/:id', async (req, reply) => {
  const s = app.currentStudent();
  const count = db.prepare('SELECT COUNT(*) c FROM conversation_thread WHERE student_id = ?').get(s.id).c;
  if (count <= 1) return reply.code(400).send({ error: 'Cannot delete the last thread — archive it instead.' });
  db.prepare('DELETE FROM conversation_message WHERE thread_id = ? AND student_id = ?').run(req.params.id, s.id);
  const r = db.prepare('DELETE FROM conversation_thread WHERE id = ? AND student_id = ?').run(req.params.id, s.id);
  if (r.changes === 0) return reply.code(404).send({ error: 'Thread not found' });
  return { ok: true };
});

// ----- Agent messages -----
app.get('/api/agent/messages', async (req) => {
  const s = app.currentStudent();
  const threadId = resolveThreadId(s.id, req.query.thread_id ? Number(req.query.thread_id) : null);
  return db.prepare(`SELECT * FROM conversation_message
    WHERE student_id = ? AND thread_id = ?
    ORDER BY id ASC LIMIT 200`).all(s.id, threadId);
});

app.post('/api/agent/message', async (req, reply) => {
  const s = app.currentStudent();
  const text = (req.body?.text ?? '').trim();
  const context = (req.body?.context ?? 'agent').toString();
  const threadId = resolveThreadId(s.id, req.body?.thread_id ? Number(req.body.thread_id) : null);
  if (!text) return reply.code(400).send({ error: 'text required' });
  const priorCount = db.prepare('SELECT COUNT(*) c FROM conversation_message WHERE thread_id = ?').get(threadId).c;
  db.prepare(`INSERT INTO conversation_message (student_id,thread_id,role,content) VALUES (?,?, 'user', ?)`)
    .run(s.id, threadId, text);
  // Fact extraction happens before generating the reply so the reply can reference freshly-captured facts.
  const extracted = extractFacts(s.id, text);
  const reply_text = await generateAgentReply(text, s, context, priorCount === 0, { threadId, extracted });
  db.prepare(`INSERT INTO conversation_message (student_id,thread_id,role,content) VALUES (?,?, 'assistant', ?)`)
    .run(s.id, threadId, reply_text);
  return { reply: reply_text, thread_id: threadId, extracted_facts: extracted.length };
});

app.delete('/api/agent/messages', async (req) => {
  const s = app.currentStudent();
  if (req.query.thread_id) {
    db.prepare('DELETE FROM conversation_message WHERE thread_id = ? AND student_id = ?')
      .run(Number(req.query.thread_id), s.id);
  } else {
    db.prepare('DELETE FROM conversation_message WHERE student_id = ?').run(s.id);
  }
  return { ok: true };
});

// ----- Facts -----
app.get('/api/facts', async () => {
  const s = app.currentStudent();
  return db.prepare(`SELECT * FROM student_fact WHERE student_id = ?
    ORDER BY created_at DESC, id DESC`).all(s.id);
});

app.post('/api/facts', async (req, reply) => {
  const s = app.currentStudent();
  const body = (req.body?.body ?? '').trim();
  const category = categoryGuard(req.body?.category);
  const source = req.body?.source === 'extracted' ? 'extracted' : 'remember';
  if (!body) return reply.code(400).send({ error: 'body required' });
  const info = db.prepare(`INSERT INTO student_fact (student_id,category,body,source,confidence)
    VALUES (?,?,?,?,?)`).run(s.id, category, body, source, source === 'remember' ? 1.0 : 0.7);
  return { id: info.lastInsertRowid };
});

app.patch('/api/facts/:id', async (req, reply) => {
  const s = app.currentStudent();
  const fields = [];
  const values = [];
  if (req.body?.body !== undefined) { fields.push('body = ?'); values.push(String(req.body.body).trim()); }
  if (req.body?.category !== undefined) { fields.push('category = ?'); values.push(categoryGuard(req.body.category)); }
  if (req.body?.source !== undefined) {
    const src = req.body.source === 'remember' ? 'remember' : 'extracted';
    fields.push('source = ?'); values.push(src);
    fields.push('confidence = ?'); values.push(src === 'remember' ? 1.0 : 0.7);
  }
  if (!fields.length) return reply.code(400).send({ error: 'No fields to update' });
  values.push(req.params.id, s.id);
  const r = db.prepare(`UPDATE student_fact SET ${fields.join(', ')} WHERE id = ? AND student_id = ?`).run(...values);
  if (r.changes === 0) return reply.code(404).send({ error: 'Not found' });
  return { ok: true };
});

app.delete('/api/facts/:id', async (req, reply) => {
  const s = app.currentStudent();
  const r = db.prepare('DELETE FROM student_fact WHERE id = ? AND student_id = ?')
    .run(req.params.id, s.id);
  if (r.changes === 0) return reply.code(404).send({ error: 'Not found' });
  return { ok: true };
});

function categoryGuard(c) {
  const allowed = ['preference','context','goal','schedule','topic','other'];
  return allowed.includes(c) ? c : 'other';
}

// Heuristic fact extraction — returns array of inserted rows.
function extractFacts(studentId, text) {
  if (!text || text.startsWith('/')) return [];
  const inserts = [];
  const add = (category, body, confidence = 0.7) => {
    const clean = body.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length < 3 || clean.length > 200) return;
    // Deduplicate (case-insensitive, substring-aware): skip if an existing fact
    // already contains the new body, or if the new body subsumes an existing one.
    const lower = clean.toLowerCase();
    const rows = db.prepare(`SELECT id, body FROM student_fact WHERE student_id = ?`).all(studentId);
    for (const r of rows) {
      const rl = r.body.toLowerCase();
      if (rl === lower || rl.includes(lower) || lower.includes(rl)) return;
    }
    const info = db.prepare(`INSERT INTO student_fact (student_id,category,body,source,confidence)
      VALUES (?,?,?,?,?)`).run(studentId, category, clean, 'extracted', confidence);
    inserts.push({ id: info.lastInsertRowid, category, body: clean });
  };
  const patterns = [
    [/\bi(?:'m| am) an?\s+([a-z][a-z ]{2,30})\s+learner\b/i, (m) => add('preference', `${capitalise(m[1])} learner`)],
    [/\bi (?:prefer|like) (.{4,80}?)(?:[.!?,;]|$)/i,         (m) => add('preference', `Prefers ${m[1]}`)],
    [/\bmy (?:goal|target) (?:is|:)\s*(?:to\s+)?(.{4,100}?)(?:[.!?,;]|$)/i, (m) => add('goal', capitalise(m[1]))],
    [/\bi(?:'m| am) aiming (?:for|at)\s+(.{4,80}?)(?:[.!?,;]|$)/i, (m) => add('goal', `Aiming for ${m[1]}`)],
    [/\bi(?:'m| am) targeting\s+(.{4,80}?)(?:[.!?,;]|$)/i,    (m) => add('goal', `Targeting ${m[1]}`)],
    [/\bi (?:work|have a job) (.{3,60}?)(?:[.!?,;]|$)/i,      (m) => add('schedule', `Works ${m[1]}`)],
    [/\bi (?:live|commute from|commute to)\s+(.{3,60}?)(?:[.!?,;]|$)/i, (m) => add('context', `${capitalise(m[0].slice(2))}`)],
    [/\bi struggle(?:d)? with\s+(.{3,80}?)(?:[.!?,;]|$)/i,    (m) => add('topic', `Struggles with ${m[1]}`)],
    [/\bi(?:'m| am) studying\s+(.{3,60}?)(?:[.!?,;]|$)/i,     (m) => add('context', `Studying ${m[1]}`)],
    [/\bi(?:'m| am)\s+(dyslexic|colour[- ]blind|color[- ]blind|an adult learner|an international student|neurodivergent)\b/i,
      (m) => add('context', capitalise(m[1]), 0.8)],
  ];
  for (const [re, fn] of patterns) {
    const m = re.exec(text);
    if (m) fn(m);
  }
  return inserts;
}
function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ----- Nudges -----
app.get('/api/nudges', async () => {
  const s = app.currentStudent();
  return { nudges: generateNudges(s) };
});

app.post('/api/nudges/dismiss', async (req, reply) => {
  const s = app.currentStudent();
  const key = (req.body?.key ?? '').toString();
  if (!key) return reply.code(400).send({ error: 'key required' });
  db.prepare(`INSERT OR IGNORE INTO nudge_dismissal (student_id, nudge_key) VALUES (?, ?)`).run(s.id, key);
  return { ok: true };
});

app.post('/api/nudges/reset', async () => {
  const s = app.currentStudent();
  db.prepare('DELETE FROM nudge_dismissal WHERE student_id = ?').run(s.id);
  return { ok: true };
});

// ----- Demo reset (dev only) -----
// Wipes all data and re-runs the seed in-place, so a presenter can replay a demo
// without restarting the server. Gated on UNISTUDENT_DEMO=1 to avoid exposing it
// in any non-demo deployment.
const demoEnabled = process.env.UNISTUDENT_DEMO === '1';
app.get('/api/demo/status', async () => ({ enabled: demoEnabled }));
app.post('/api/demo/reset', async (req, reply) => {
  if (!demoEnabled) return reply.code(403).send({ error: 'Demo reset is disabled. Start the server with UNISTUDENT_DEMO=1 to enable.' });
  clearAllData(db);
  const stats = insertSeedData(db);
  return { ok: true, ...stats };
});

function generateNudges(student) {
  const dismissed = new Set(
    db.prepare(`SELECT nudge_key FROM nudge_dismissal WHERE student_id = ?`).all(student.id).map(r => r.nudge_key)
  );
  const nudges = [];
  const push = (n) => {
    if (dismissed.has(n.key)) return;
    nudges.push(n);
  };

  // Plan validation issues
  const { issues } = validatePlan(student.id);
  const errors = issues.filter(i => i.severity === 'error');
  const clashIssues = issues.filter(i => i.kind === 'clash');
  if (errors.length) {
    push({
      key: 'plan:errors:' + errors.map(e => e.subject_code).join(','),
      kind: 'warn', icon: 'alert',
      title: `${errors.length} prerequisite issue${errors.length === 1 ? '' : 's'} in your plan`,
      body: errors.slice(0, 2).map(e => `${e.subject_code}: ${e.message}`).join(' · ') +
            (errors.length > 2 ? ` · +${errors.length - 2} more` : ''),
      action_label: 'Open planner',
      action_url: '/planner.html',
    });
  }
  // Timetable clash nudges — one per pair so dismissing one doesn't hide others
  for (const ci of clashIssues) {
    push({
      key: `clash:${ci.session_a}:${ci.session_b}`,
      kind: 'warn', icon: 'alert',
      title: `Timetable clash: ${ci.subject_code}`,
      body: ci.message,
      action_label: 'View timetable',
      action_url: '/timetable.html',
    });
  }

  // Component gap
  const components = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status = 'completed'), 0) AS completed_cp,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status IN ('enrolled','planned')), 0) AS in_progress_cp
    FROM component c
    JOIN student_component sc ON sc.component_id = c.id AND sc.student_id = ?`).all(student.id, student.id, student.id);
  for (const c of components) {
    const gap = c.credit_points - c.completed_cp - c.in_progress_cp;
    if (gap > 0) {
      push({
        key: `gap:${c.id}`,
        kind: 'info', icon: 'gap',
        title: `${gap} CP short on ${c.title}`,
        body: `You need another ${Math.ceil(gap / 15)} subject${Math.ceil(gap / 15) === 1 ? '' : 's'} in this component to satisfy course rules.`,
        action_label: 'Review plan',
        action_url: '/planner.html',
      });
    }
  }

  // Low future semester load
  const lowSem = db.prepare(`
    SELECT tp.code, tp.label, COALESCE(SUM(s.credit_points), 0) AS cp
    FROM teaching_period tp
    LEFT JOIN student_plan_entry p ON p.teaching_period = tp.code AND p.student_id = ?
    LEFT JOIN subject s ON s.code = p.subject_code
    WHERE tp.status = 'future'
    GROUP BY tp.code
    HAVING cp > 0 AND cp < 45
    ORDER BY tp.sort_order ASC LIMIT 1`).get(student.id);
  if (lowSem) {
    push({
      key: `lowload:${lowSem.code}`,
      kind: 'info', icon: 'load',
      title: `Only ${lowSem.cp} CP planned for ${lowSem.label}`,
      body: `Full-time load is 60 CP. Add subjects to stay on track for on-time graduation.`,
      action_label: 'Open planner',
      action_url: '/planner.html',
    });
  }

  // Assessment forecasts — flag projected fails and incomplete weight setups
  const assessedSubjects = db.prepare(`SELECT DISTINCT subject_code FROM assessment WHERE student_id = ?`)
    .all(student.id);
  for (const { subject_code } of assessedSubjects) {
    const f = computeForecast(student.id, subject_code);
    if (!f) continue;
    if (f.scenarios.expected < 50) {
      push({
        key: `forecast:fail:${subject_code}`,
        kind: 'warn', icon: 'alert',
        title: `${subject_code} projected to fail (${f.scenarios.expected}%)`,
        body: `At your current rate you'd finish below 50%. Best case is ${f.scenarios.best}%.`,
        action_label: 'Open progress',
        action_url: '/progress.html',
      });
    } else if (f.weight_warning) {
      push({
        key: `forecast:weights:${subject_code}`,
        kind: 'info', icon: 'alert',
        title: `${subject_code} assessments don't add to 100%`,
        body: f.weight_warning + ' — the forecast may be off until you add the missing pieces.',
        action_label: 'Open progress',
        action_url: '/progress.html',
      });
    }
  }

  // Free block + upcoming deadline
  const currentPeriod = db.prepare(`SELECT code FROM teaching_period WHERE status='current'`).get();
  if (currentPeriod) {
    const sessions = db.prepare(`SELECT day_of_week, start_time, duration_min FROM timetable_session
      WHERE teaching_period = ? AND is_active = 1
      AND subject_code IN (SELECT subject_code FROM student_plan_entry WHERE student_id=? AND status='enrolled')`)
      .all(currentPeriod.code, student.id);
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcoming = db.prepare(`SELECT * FROM reminder WHERE student_id = ? AND done = 0
      AND due_at BETWEEN ? AND ? ORDER BY due_at ASC LIMIT 1`).get(student.id,
        toLocalIso(now), toLocalIso(soon));
    if (upcoming) {
      // Find largest gap today or tomorrow
      const today = now.getDay();
      const tomorrow = (today + 1) % 7;
      for (const dow of [today, tomorrow]) {
        const busy = sessions.filter(s => s.day_of_week === dow)
          .map(s => {
            const [h, m] = s.start_time.split(':').map(Number);
            return { start: h * 60 + m, end: h * 60 + m + s.duration_min };
          })
          .sort((a, b) => a.start - b.start);
        let cursor = 8 * 60, best = { len: 0 };
        for (const b of busy) {
          if (b.start - cursor > best.len) best = { start: cursor, end: b.start, len: b.start - cursor };
          cursor = Math.max(cursor, b.end);
        }
        if (19 * 60 - cursor > best.len) best = { start: cursor, end: 19 * 60, len: 19 * 60 - cursor };
        if (best.len >= 120) {
          const when = dow === today ? 'today' : 'tomorrow';
          push({
            key: `study:${upcoming.id}:${when}`,
            kind: 'info', icon: 'study',
            title: `You have a ${Math.floor(best.len / 60)}-hour free block ${when}`,
            body: `${when[0].toUpperCase() + when.slice(1)} ${fmtMin(best.start)}–${fmtMin(best.end)} — good chance to prep for "${upcoming.title}".`,
            action_label: 'Open timetable',
            action_url: '/timetable.html',
          });
          break;
        }
      }
    }
  }

  return nudges.slice(0, 4);

  function fmtMin(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  function toLocalIso(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

const CONTEXT_HINTS = {
  dashboard: ['`/focus`', '`/schedule`', '`/deadlines`', '`/progress`'],
  planner:   ['`/focus`', '`/validate`', '`/prereq <CODE>`', '`/alternatives <CODE>`'],
  timetable: ['`/focus`', '`/next`', '`/clashes`', '`/resolve <CODE>`'],
  progress:  ['`/focus`', '`/gpa`', '`/forecast <CODE>`', '`/assessments <CODE>`'],
  reminders: ['`/focus`', '`/deadlines`', '`/remind <title> @<when>`'],
  facts:     ['`/facts`', '`/remember <fact>`', '`/forget <id>`'],
  settings:  ['`/help`', '`/facts`', '`/progress`'],
  agent:     ['`/focus`', '`/help`', '`/schedule`', '`/clashes`', '`/progress`', '`/plan`', '`/deadlines`'],
};

function helpReply(student, context) {
  const hints = CONTEXT_HINTS[context] ?? CONTEXT_HINTS.agent;
  const firstName = student.full_name.split(' ')[0];
  const preamble = context === 'agent' || !CONTEXT_HINTS[context]
    ? `Hi ${firstName}. I can help with:`
    : `Hi ${firstName}. On this page you'll probably want:`;
  const full = [
    preamble, '',
    ...hints.map(h => `- ${h}`),
    '',
    'Other commands: `/focus` `/schedule` `/plan` `/progress` `/deadlines` `/practice <topic>` `/explain <topic>`.',
    '',
    'Academic integrity note: I will not write assessments for you, but I can explain concepts and help you study.',
  ].join('\n');
  return full;
}

async function generateAgentReply(text, student, context = 'agent', isFirstMessage = false, extra = {}) {
  const lower = text.toLowerCase();
  const rawCmd = text.startsWith('/') ? text.split(/\s+/)[0].toLowerCase() : null;
  const aliases = { '/upcoming': '/deadlines', '/requirements': '/gap', '/memory': '/facts' };
  const cmd = aliases[rawCmd] ?? rawCmd;
  const arg = text.includes(' ') ? text.slice(text.indexOf(' ') + 1).trim() : '';
  const extractedNote = (extra.extracted ?? []).length
    ? `\n\n_I noted ${extra.extracted.length} new thing${extra.extracted.length === 1 ? '' : 's'} about you — see \`/facts\` to review._`
    : '';

  // Contextual disambiguation for bare greetings on first message
  if (!cmd && isFirstMessage && /^(hi|hello|hey|yo|what'?s up|help)\b/.test(lower)) {
    return helpReply(student, context);
  }

  if (cmd === '/help' || /what can you do|help me/.test(lower)) {
    return helpReply(student, context);
  }

  if (cmd === '/schedule' || /schedule|timetable|today|class/.test(lower)) {
    return replySchedule(student);
  }
  if (cmd === '/next' || /what'?s next|next class/.test(lower)) {
    return replyNext(student);
  }
  if (cmd === '/freeslots' || /free slots|free time/.test(lower)) {
    return replyFreeSlots(student);
  }
  if (cmd === '/changes') {
    return replyChanges();
  }
  if (cmd === '/progress' || /progress|grade/.test(lower)) {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard' });
    const d = res.json();
    const pct = Math.round((d.credits.completed / d.credits.total) * 100);
    return `**Degree progress**\n\n- ${d.credits.completed}/${d.credits.total} CP completed (${pct}%)\n- ${d.credits.enrolled} CP currently enrolled\n- ${d.credits.planned} CP planned\n- GPA: ${d.gpa ?? '—'}`;
  }
  if (cmd === '/gpa') {
    return replyGpa(student);
  }
  if (cmd === '/milestones') {
    return replyMilestones(student);
  }
  if (cmd === '/gap') {
    return replyGap(student);
  }
  if (cmd === '/plan' || /study plan|my plan/.test(lower)) {
    return replyPlan(student);
  }
  if (cmd === '/validate') {
    return replyValidate(student);
  }
  if (cmd === '/prereq') {
    return replyPrereq(arg);
  }
  if (cmd === '/alternatives') {
    return replyAlternatives(student, arg);
  }
  if (cmd === '/deadlines' || /deadline|due|assignment/.test(lower)) {
    return replyDeadlines(student);
  }
  if (cmd === '/assessments') {
    return replyAssessments(student, arg);
  }
  if (cmd === '/forecast') {
    return replyForecast(student, arg);
  }
  if (cmd === '/focus') {
    return replyFocus(student);
  }
  if (cmd === '/remind') {
    return replyRemind(student, arg);
  }
  if (cmd === '/practice') {
    const subject = arg || 'the topic';
    return `Here are 3 practice questions on **${subject}**:\n\n1. Explain the key concept in your own words.\n2. Apply it to a worked example.\n3. Identify a common pitfall and how to avoid it.\n\n_(PoC stub — connect a model provider to generate real questions.)_`;
  }
  if (cmd === '/explain') {
    const topic = arg || 'this topic';
    return `**${topic}** — in a full build I'd explain this using your course context and past questions. _(PoC stub.)_`;
  }
  if (cmd === '/clashes') {
    return replyClashes(student);
  }
  if (cmd === '/resolve') {
    return replyResolveClash(student, arg);
  }
  if (cmd === '/facts') {
    return replyFacts(student);
  }
  if (cmd === '/remember') {
    return replyRemember(student, arg);
  }
  if (cmd === '/forget') {
    return replyForget(student, arg);
  }
  // If we extracted anything, append a transparent note to any reply below.
  return `I didn't match that to a specific command. Try \`/help\` to see what I can do. You said: "${text}".${extractedNote}`;
}

// ----- Command replies -----

function replySchedule(student) {
  const currentPeriod = db.prepare(`SELECT code FROM teaching_period WHERE status='current'`).get();
  if (!currentPeriod) return 'No current teaching period.';
  const rows = db.prepare(`SELECT ts.*, s.title FROM timetable_session ts
    JOIN subject s ON s.code = ts.subject_code
    WHERE ts.teaching_period = ? AND ts.day_of_week = ? AND ts.is_active = 1
    AND ts.subject_code IN (SELECT subject_code FROM student_plan_entry WHERE student_id=? AND status='enrolled')
    ORDER BY ts.start_time`).all(currentPeriod.code, new Date().getDay(), student.id);
  if (!rows.length) return 'No classes today. Ask `/next` to see the next upcoming class.';
  return `**Today's classes**\n\n` + rows.map(r =>
    `- ${r.start_time} — ${r.subject_code} ${r.activity_type} (${r.location})`).join('\n');
}

function replyNext(student) {
  const now = new Date();
  const currentPeriod = db.prepare(`SELECT code FROM teaching_period WHERE status='current'`).get();
  if (!currentPeriod) return 'No classes scheduled.';
  const sessions = db.prepare(`SELECT ts.*, s.title FROM timetable_session ts
    JOIN subject s ON s.code = ts.subject_code
    WHERE ts.teaching_period = ? AND ts.is_active = 1
    AND ts.subject_code IN (SELECT subject_code FROM student_plan_entry WHERE student_id=? AND status='enrolled')
    ORDER BY ts.day_of_week, ts.start_time`).all(currentPeriod.code, student.id);
  if (!sessions.length) return 'No enrolled classes.';
  const nowDow = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const ordered = [...sessions].sort((a, b) => {
    const ak = daysUntil(a, nowDow, nowMin, toMin);
    const bk = daysUntil(b, nowDow, nowMin, toMin);
    return ak - bk;
  });
  const next = ordered[0];
  const inFuture = daysUntil(next, nowDow, nowMin, toMin);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const when = inFuture === 0
    ? `today at ${next.start_time} (${Math.round((toMin(next.start_time) - nowMin))} min away)`
    : `${dayNames[next.day_of_week]} at ${next.start_time}`;
  return `**Next class**\n\n- **${next.subject_code}** ${next.activity_type} — ${next.title}\n- ${when}\n- ${next.location} · ${next.delivery_mode}\n- ${next.duration_min} min`;

  function daysUntil(s, dow, minNow, toMinFn) {
    const mins = toMinFn(s.start_time);
    let d = s.day_of_week - dow;
    if (d < 0) d += 7;
    if (d === 0 && mins <= minNow) d = 7;
    return d * 1440 + mins;
  }
}

function replyFreeSlots(student) {
  const currentPeriod = db.prepare(`SELECT code FROM teaching_period WHERE status='current'`).get();
  if (!currentPeriod) return 'No current teaching period.';
  const sessions = db.prepare(`SELECT ts.day_of_week, ts.start_time, ts.duration_min
    FROM timetable_session ts
    WHERE ts.teaching_period = ? AND ts.is_active = 1
    AND ts.subject_code IN (SELECT subject_code FROM student_plan_entry WHERE student_id=? AND status='enrolled')
    ORDER BY ts.day_of_week, ts.start_time`).all(currentPeriod.code, student.id);
  const byDay = {};
  for (const s of sessions) (byDay[s.day_of_week] ??= []).push(s);
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const lines = [];
  for (let d = 1; d <= 5; d++) {
    const busy = (byDay[d] ?? []).map(s => {
      const [h, m] = s.start_time.split(':').map(Number);
      return { start: h * 60 + m, end: h * 60 + m + s.duration_min };
    }).sort((a, b) => a.start - b.start);
    const gaps = [];
    let cursor = 8 * 60; // 08:00
    const endDay = 19 * 60; // 19:00
    for (const b of busy) {
      if (b.start - cursor >= 60) gaps.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (endDay - cursor >= 60) gaps.push({ start: cursor, end: endDay });
    if (gaps.length) {
      const gapStrs = gaps.map(g => `${fmtMin(g.start)}–${fmtMin(g.end)}`).join(', ');
      lines.push(`- **${dayNames[d]}**: ${gapStrs}`);
    }
  }
  if (!lines.length) return 'No free slots found (08:00–19:00, weekdays).';
  return `**Free study slots (weekdays, ≥60 min)**\n\n${lines.join('\n')}`;

  function fmtMin(m) {
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}

function replyChanges() {
  return `**Recent timetable changes**\n\n- CSE3001 Tutorial moved from Lab 3.02 to Lab 2.05 (Thursday)\n- SWE3003 Workshop: new guest lecturer Wed 14:00\n\n_(PoC stub — real system pulls from Allocate+ change feed.)_`;
}

function replyGpa(student) {
  const grades = db.prepare(`
    SELECT p.teaching_period, tp.label,
           AVG(CASE p.grade WHEN 'HD' THEN 4.0 WHEN 'D' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'P' THEN 1.0 ELSE NULL END) AS gpa,
           COUNT(*) AS n
    FROM student_plan_entry p
    JOIN teaching_period tp ON tp.code = p.teaching_period
    WHERE p.student_id = ? AND p.status='completed'
    GROUP BY p.teaching_period ORDER BY tp.sort_order`).all(student.id);
  if (!grades.length) return 'No completed subjects yet.';
  const overall = grades.reduce((s, g) => s + (g.gpa ?? 0) * g.n, 0) / grades.reduce((s, g) => s + g.n, 0);
  return `**GPA trend** (4.0 scale)\n\n` +
    grades.map(g => `- ${g.label}: **${g.gpa.toFixed(2)}** across ${g.n} subject${g.n === 1 ? '' : 's'}`).join('\n') +
    `\n\nOverall: **${overall.toFixed(2)}**`;
}

function replyMilestones(student) {
  const year = new Date().getFullYear();
  return `**Milestones**\n\n` +
    `- ✓ ${year - 2} Year 1 complete (120 CP)\n` +
    `- ✓ ${year - 1} Year 2 complete\n` +
    `- **Now** · Year 3 Sem 1 in progress\n` +
    `- ${year} Jul · Sem 2 enrolment opens\n` +
    `- ${year} Nov · Projected graduation`;
}

function replyGap(student) {
  const components = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status = 'completed'), 0) AS completed_cp,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status IN ('enrolled','planned')), 0) AS in_progress_cp
    FROM component c
    JOIN student_component sc ON sc.component_id = c.id AND sc.student_id = ?
    ORDER BY CASE c.type WHEN 'core' THEN 1 WHEN 'major' THEN 2 WHEN 'minor' THEN 3 ELSE 4 END`).all(student.id, student.id, student.id);
  return `**Requirement gaps**\n\n` + components.map(c => {
    const gap = c.credit_points - c.completed_cp - c.in_progress_cp;
    const tag = gap <= 0 ? '✓ covered' : `**${gap} CP** short`;
    return `- ${c.title}: ${c.completed_cp}+${c.in_progress_cp}/${c.credit_points} CP — ${tag}`;
  }).join('\n');
}

function replyPlan(student) {
  const rows = db.prepare(`SELECT p.*, tp.label, s.title
    FROM student_plan_entry p
    JOIN teaching_period tp ON tp.code = p.teaching_period
    JOIN subject s ON s.code = p.subject_code
    WHERE p.student_id = ? ORDER BY tp.sort_order, s.code`).all(student.id);
  const grouped = {};
  for (const r of rows) (grouped[r.label] ??= []).push(r);
  return '**Your study plan**\n\n' + Object.entries(grouped).map(([label, arr]) =>
    `${label}:\n` + arr.map(r => `  - ${r.subject_code} — ${r.title} (${r.status})`).join('\n')
  ).join('\n\n');
}

function replyValidate(student) {
  const { issues } = validatePlan(student.id);
  if (!issues.length) {
    return '**Plan validated.** All prerequisites and credit caps pass against current SISOne/CourseLoop rules.';
  }
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const parts = [`**${errors.length + warnings.length} issue${(errors.length + warnings.length) === 1 ? '' : 's'} found**`, ''];
  if (errors.length) {
    parts.push('**Errors**');
    for (const e of errors) parts.push(`- \`${e.subject_code}\` (${e.period}): ${e.message}`);
    parts.push('');
  }
  if (warnings.length) {
    parts.push('**Warnings**');
    for (const w of warnings) parts.push(`- ${w.period ? w.period + ': ' : ''}${w.message}`);
  }
  return parts.join('\n');
}

function replyPrereq(arg) {
  const code = (arg || '').toUpperCase().split(/\s+/)[0];
  if (!code) return 'Usage: `/prereq <SUBJECT-CODE>` — for example `/prereq CSE2001`.';
  const s = db.prepare('SELECT * FROM subject WHERE code = ?').get(code);
  if (!s) return `Subject \`${code}\` not found.`;
  const reqs = db.prepare('SELECT * FROM subject_requisite WHERE subject_code = ?').all(code);
  if (!reqs.length) return `**${code} — ${s.title}** has no recorded requisites.`;
  const byKind = {};
  for (const r of reqs) (byKind[r.kind] ??= []).push(r.requires_code);
  const parts = [`**${code} — ${s.title}** requisites`, ''];
  for (const kind of ['prerequisite', 'corequisite', 'incompatible', 'equivalent']) {
    if (byKind[kind]) parts.push(`- ${kind[0].toUpperCase() + kind.slice(1)}: ${byKind[kind].map(c => `\`${c}\``).join(', ')}`);
  }
  return parts.join('\n');
}

function replyAlternatives(student, arg) {
  const code = (arg || '').toUpperCase().split(/\s+/)[0];
  if (!code) return 'Usage: `/alternatives <SUBJECT-CODE>` — for example `/alternatives SWE3002`.';
  const s = db.prepare('SELECT * FROM subject WHERE code = ?').get(code);
  if (!s) return `Subject \`${code}\` not found.`;
  const offerings = db.prepare(`SELECT DISTINCT so.teaching_period, tp.label, tp.sort_order, tp.status
    FROM subject_offering so JOIN teaching_period tp ON tp.code = so.teaching_period
    WHERE so.subject_code = ? AND tp.status != 'past' ORDER BY tp.sort_order`).all(code);
  if (!offerings.length) return `\`${code}\` has no future offerings.`;
  const plan = db.prepare(`SELECT subject_code, teaching_period FROM student_plan_entry WHERE student_id = ?`).all(student.id);
  const current = plan.find(p => p.subject_code === code);
  const parts = [`**${code} — ${s.title}**`, '', 'Future offerings:'];
  for (const o of offerings) {
    const mark = current?.teaching_period === o.teaching_period ? ' · current' : '';
    parts.push(`- ${o.label}${mark}`);
  }
  const reqs = db.prepare('SELECT requires_code FROM subject_requisite WHERE subject_code = ? AND kind = ?').all(code, 'prerequisite');
  if (reqs.length) parts.push('', `Prerequisites: ${reqs.map(r => `\`${r.requires_code}\``).join(', ')} must be complete before you take this.`);
  return parts.join('\n');
}

function replyDeadlines(student) {
  const rows = db.prepare(`SELECT * FROM reminder WHERE student_id = ? AND done = 0
    ORDER BY due_at ASC LIMIT 10`).all(student.id);
  if (!rows.length) return 'No upcoming deadlines.';
  return '**Upcoming deadlines**\n\n' + rows.map(r => {
    const d = new Date(r.due_at);
    return `- ${d.toLocaleString('en-AU', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })} — ${r.title}`;
  }).join('\n');
}

function replyAssessments(student, arg) {
  const code = (arg || '').toUpperCase().split(/\s+/)[0];
  if (code) {
    const rows = db.prepare(`SELECT * FROM assessment
      WHERE student_id = ? AND subject_code = ?
      ORDER BY due_at IS NULL, due_at, id`).all(student.id, code);
    if (!rows.length) return `No assessments recorded for \`${code}\`. Add one on the Progress page.`;
    const forecast = computeForecast(student.id, code);
    const parts = [`**Assessments — \`${code}\`**`, ''];
    for (const a of rows) {
      const scored = a.score_pct != null ? `· **${a.score_pct}%**` : '· unmarked';
      const due = a.due_at
        ? new Date(a.due_at).toLocaleString('en-AU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
        : 'no date';
      parts.push(`- ${a.title} — ${a.weight_pct}% · due ${due} ${scored}`);
    }
    if (forecast) {
      parts.push('', `Forecast: expected **${forecast.scenarios.expected}%** (**${forecast.letter_forecast}**) · best ${forecast.scenarios.best} · worst ${forecast.scenarios.worst}.`);
      if (forecast.weight_warning) parts.push(`_${forecast.weight_warning}_`);
    }
    return parts.join('\n');
  }
  // No arg — summary across all enrolled subjects with assessments.
  const subjects = db.prepare(`SELECT DISTINCT subject_code FROM assessment WHERE student_id = ?
    ORDER BY subject_code`).all(student.id);
  if (!subjects.length) return 'No assessments recorded yet. Open the Progress page to add some.';
  const parts = ['**Subject forecasts**', ''];
  for (const { subject_code } of subjects) {
    const f = computeForecast(student.id, subject_code);
    parts.push(`- \`${subject_code}\` — expected **${f.scenarios.expected}%** (**${f.letter_forecast}**) · ${f.committed_weight}% marked, ${f.remaining_weight}% remaining`);
  }
  parts.push('', 'Use `/forecast <CODE>` or `/assessments <CODE>` for detail.');
  return parts.join('\n');
}

function replyForecast(student, arg) {
  const code = (arg || '').toUpperCase().split(/\s+/)[0];
  if (!code) return 'Usage: `/forecast <SUBJECT-CODE>` — e.g. `/forecast CSE3001`.';
  const f = computeForecast(student.id, code);
  if (!f) return `No assessments recorded for \`${code}\`. Add one on the Progress page.`;
  const parts = [
    `**Forecast — \`${code}\`**`, '',
    `- Earned so far: **${f.earned_pct}** on ${f.committed_weight}% of weight marked`,
    `- Remaining weight: ${f.remaining_weight}%`,
    `- Expected final: **${f.scenarios.expected}% (${f.letter_forecast})**`,
    `- Best case: ${f.scenarios.best}% · Worst case: ${f.scenarios.worst}%`,
  ];
  if (f.weight_warning) parts.push('', `_${f.weight_warning}_`);
  return parts.join('\n');
}

// Build a structured snapshot of everything the /focus synthesis needs.
// Pure function over the current DB state — reuses existing helpers.
function buildFocusContext(student) {
  const course = db.prepare('SELECT * FROM course WHERE code = ?').get(student.program_code);
  const period = db.prepare(`SELECT * FROM teaching_period WHERE status='current'`).get();

  const enrolled = db.prepare(`
    SELECT p.subject_code, s.title
    FROM student_plan_entry p
    JOIN subject s ON s.code = p.subject_code
    WHERE p.student_id = ? AND p.status = 'enrolled'
    ORDER BY p.subject_code`).all(student.id);
  const subject_forecasts = enrolled.map(e => {
    const f = computeForecast(student.id, e.subject_code);
    if (!f) return { subject: e.subject_code, title: e.title, note: 'no assessments recorded' };
    return {
      subject: e.subject_code,
      title: e.title,
      expected_pct: f.scenarios.expected,
      best_pct: f.scenarios.best,
      worst_pct: f.scenarios.worst,
      letter_forecast: f.letter_forecast,
      marked_weight: f.committed_weight,
      remaining_weight: f.remaining_weight,
      weight_warning: f.weight_warning,
    };
  });

  const { clashes, sessions } = detectClashes(student.id);
  const byId = Object.create(null);
  for (const s of sessions) byId[s.id] = s;
  const active_clashes = clashes.map(c => {
    const a = byId[c.a], b = byId[c.b];
    return `${a.subject_code} ${a.activity_type} (${DAY_SHORT[a.day_of_week]} ${a.start_time}) overlaps ${b.subject_code} ${b.activity_type} (${DAY_SHORT[b.day_of_week]} ${b.start_time})`;
  });

  const components = db.prepare(`
    SELECT c.*,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status = 'completed'), 0) AS completed_cp,
      COALESCE((SELECT SUM(sub.credit_points) FROM subject sub
        JOIN component_subject cs ON cs.subject_code = sub.code AND cs.component_id = c.id
        JOIN student_plan_entry p ON p.subject_code = sub.code
        WHERE p.student_id = ? AND p.status IN ('enrolled','planned')), 0) AS in_progress_cp
    FROM component c
    JOIN student_component sc ON sc.component_id = c.id AND sc.student_id = ?`)
    .all(student.id, student.id, student.id);
  const component_gaps = components
    .map(c => ({
      component: c.title,
      type: c.type,
      required_cp: c.credit_points,
      completed_cp: c.completed_cp,
      in_progress_cp: c.in_progress_cp,
      remaining_cp: c.credit_points - c.completed_cp - c.in_progress_cp,
    }))
    .filter(g => g.remaining_cp > 0);

  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const toLocalIso = d =>
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const upcoming_deadlines = db.prepare(`
    SELECT title, due_at, kind, subject_code FROM reminder
    WHERE student_id = ? AND done = 0 AND due_at BETWEEN ? AND ?
    ORDER BY due_at ASC LIMIT 15`)
    .all(student.id, toLocalIso(now), toLocalIso(horizon));

  const facts = db.prepare(`SELECT category, body FROM student_fact WHERE student_id = ?`)
    .all(student.id)
    .map(f => `[${f.category}] ${f.body}`);

  const gpaRow = db.prepare(`
    SELECT AVG(CASE grade WHEN 'HD' THEN 4.0 WHEN 'D' THEN 3.0 WHEN 'C' THEN 2.0 WHEN 'P' THEN 1.0 ELSE NULL END) AS gpa
    FROM student_plan_entry WHERE student_id = ? AND status='completed'`).get(student.id);

  return {
    today: toLocalIso(now),
    student: {
      name: student.full_name,
      program: course?.title ?? student.program_code,
      year_level: student.year_level,
      international: !!student.is_international,
    },
    current_period: period ? { label: period.label, ends: period.end_date } : null,
    gpa_4_scale: gpaRow.gpa ? Number(gpaRow.gpa.toFixed(2)) : null,
    subject_forecasts,
    active_clashes,
    component_gaps,
    upcoming_deadlines,
    facts,
  };
}

const FOCUS_SYSTEM_PROMPT = `You are Unistudent, a concise study advisor for university students.

You are given a structured snapshot of one student's current situation: enrolled subjects with forecast grades, active timetable clashes, upcoming deadlines (next 14 days), component/requirement gaps, GPA, and saved facts about the student's preferences and schedule.

Your job: identify the SINGLE most impactful thing this student should focus on right now, and tell them what to do about it.

Rules:
- Output 3–5 sentences of plain markdown. No headings, no bullet lists inside the paragraph, no emoji, no empty encouragement ("you've got this!").
- Be specific. Cite subject codes, dates/times, weights, expected percentages, section codes when relevant.
- Weigh severity honestly: a projected-fail forecast outranks a minor clash; an unresolved clash outranks a low-weight assessment far out.
- Use the student's saved facts (e.g. "visual learner", "works Tue/Thu evenings") only when they actually change what to recommend.
- Never offer to write an assessment, exam answer, or graded submission. Explaining concepts, planning study time, and reviewing material is fine.
- End with exactly one line formatted as: **Next action:** <one concrete verb-first instruction>`;

async function replyFocus(student) {
  const context = buildFocusContext(student);
  if (!llmClient) {
    return [
      '**/focus needs an OpenRouter API key.**',
      '',
      'Set `OPENROUTER_API_KEY` in the environment and restart the server. Override the model with `UNISTUDENT_LLM_MODEL` (default `z-ai/glm-4.7`).',
      '',
      'Until then, here is the structured snapshot `/focus` would send to the model:',
      '',
      '```json',
      JSON.stringify(context, null, 2),
      '```',
    ].join('\n');
  }
  try {
    const firstName = context.student.name.split(' ')[0];
    const completion = await llmClient.chat.send({
      chatRequest: {
        model: llmModel,
        stream: false,
        messages: [
          { role: 'system', content: FOCUS_SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `Here is ${firstName}'s snapshot:\n\n` +
              '```json\n' + JSON.stringify(context, null, 2) + '\n```\n\n' +
              `What is the single most impactful thing ${firstName} should focus on right now?`,
          },
        ],
      },
    });
    const text = completion?.choices?.[0]?.message?.content?.trim();
    return text || '_(Model returned an empty response — try again.)_';
  } catch (e) {
    const base = `OpenRouter call failed (${e.status ?? 'network'}): ${e.message ?? e}`;
    return `${base}\n\n_Falling back to the raw snapshot:_\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;
  }
}

function replyRemind(student, arg) {
  if (!arg) return 'Usage: `/remind <title> @<when>` — for example `/remind Review CSE3001 notes @tomorrow 17:00` or `@2026-05-01T14:00`.';
  const atIdx = arg.lastIndexOf('@');
  if (atIdx === -1) return 'Include a time with `@<when>`. Example: `/remind Finish lab @friday 9am`.';
  const title = arg.slice(0, atIdx).trim();
  const whenStr = arg.slice(atIdx + 1).trim();
  if (!title) return 'Reminder title is empty. Example: `/remind Finish lab @friday 9am`.';
  const when = parseWhen(whenStr);
  if (!when) return `Couldn't parse \`@${whenStr}\`. Try ISO (\`@2026-05-01T14:00\`), \`@tomorrow 17:00\`, or \`@friday 9am\`.`;
  const localIso = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const info = db.prepare(`INSERT INTO reminder (student_id,title,due_at,kind,subject_code) VALUES (?,?,?,?,?)`)
    .run(student.id, title, localIso, 'study', null);
  return `**Reminder added** (id ${info.lastInsertRowid})\n\n- ${title}\n- Due ${when.toLocaleString('en-AU', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`;
}

function replyClashes(student) {
  const { period, sessions, clashes } = detectClashes(student.id);
  if (!period) return 'No current teaching period.';
  if (!clashes.length) return `**No timetable clashes** in ${period.label}. Your week is clean.`;
  const byId = Object.create(null);
  for (const s of sessions) byId[s.id] = s;
  const parts = [`**${clashes.length} timetable clash${clashes.length === 1 ? '' : 'es'} in ${period.label}**`, ''];
  for (const c of clashes) {
    const a = byId[c.a], b = byId[c.b];
    parts.push(`- \`${a.subject_code}\` ${a.activity_type} (${DAY_SHORT[a.day_of_week]} ${a.start_time}, ${a.location})`);
    parts.push(`  overlaps \`${b.subject_code}\` ${b.activity_type} (${DAY_SHORT[b.day_of_week]} ${b.start_time}, ${b.location})`);
  }
  parts.push('', 'Try `/resolve <CODE>` for suggestions, or open the Timetable to send changes to Allocate+.');
  return parts.join('\n');
}

// Find alternate sections for a given subject+activity_type that don't clash with the
// student's OTHER active sessions in the same period.
function findAlternateSections(studentId, subjectCode, activityType, periodCode, excludeSessionId) {
  const busy = db.prepare(`
    SELECT day_of_week, start_time, duration_min
    FROM timetable_session
    WHERE teaching_period = ? AND is_active = 1
      AND id != ?
      AND subject_code IN (
        SELECT subject_code FROM student_plan_entry
        WHERE student_id = ? AND status = 'enrolled'
      )
  `).all(periodCode, excludeSessionId, studentId);

  const alternates = db.prepare(`
    SELECT * FROM timetable_session
    WHERE teaching_period = ?
      AND subject_code = ?
      AND activity_type = ?
      AND is_active = 0
    ORDER BY day_of_week, start_time
  `).all(periodCode, subjectCode, activityType);

  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const clashesWith = (alt, list) => {
    const aS = toMin(alt.start_time), aE = aS + alt.duration_min;
    return list.find(b =>
      b.day_of_week === alt.day_of_week &&
      aS < toMin(b.start_time) + b.duration_min &&
      toMin(b.start_time) < aE
    );
  };
  return alternates.map(alt => ({ alt, blocker: clashesWith(alt, busy) }));
}

function replyResolveClash(student, arg) {
  const code = (arg || '').toUpperCase().split(/\s+/)[0];
  if (!code) return 'Usage: `/resolve <SUBJECT-CODE>` — e.g. `/resolve CSE3001`.';
  const { period, sessions, clashes } = detectClashes(student.id);
  if (!period) return 'No current teaching period.';
  const byId = Object.create(null);
  for (const s of sessions) byId[s.id] = s;
  const involved = clashes
    .filter(c => byId[c.a].subject_code === code || byId[c.b].subject_code === code)
    .map(c => [byId[c.a], byId[c.b]]);
  if (!involved.length) return `\`${code}\` has no clashes this semester.`;

  const parts = [`**Resolve clashes for \`${code}\`**`, ''];
  for (const [a, b] of involved) {
    const mine = a.subject_code === code ? a : b;
    const other = a.subject_code === code ? b : a;
    parts.push(`- **${mine.activity_type}** ${DAY_SHORT[mine.day_of_week]} ${mine.start_time}${mine.section_code ? ` (${mine.section_code})` : ''} clashes with \`${other.subject_code}\` ${other.activity_type} ${DAY_SHORT[other.day_of_week]} ${other.start_time}.`);

    // Lectures typically have no alternate section.
    if (mine.activity_type === 'Lecture') {
      parts.push(`  _Lectures don't have alternate sections — you may need to swap the other subject's \`${other.subject_code}\` ${other.activity_type} instead (try \`/resolve ${other.subject_code}\`)._`);
      continue;
    }

    const options = findAlternateSections(student.id, code, mine.activity_type, period.code, mine.id);
    const clean = options.filter(o => !o.blocker);
    const blocked = options.filter(o => o.blocker);

    if (!options.length) {
      parts.push('  No alternate sections exist for this activity.');
      continue;
    }
    if (clean.length) {
      parts.push('  Clash-free alternates:');
      for (const { alt } of clean) {
        parts.push(`    - ${alt.section_code ?? '—'} — ${DAY_SHORT[alt.day_of_week]} ${alt.start_time}, ${alt.location}`);
      }
    } else {
      parts.push('  No clash-free alternates — every option conflicts with another enrolled session.');
    }
    if (blocked.length) {
      parts.push('  Other options (would still clash):');
      for (const { alt, blocker } of blocked) {
        parts.push(`    - ${alt.section_code ?? '—'} — ${DAY_SHORT[alt.day_of_week]} ${alt.start_time} (clashes with another session at ${blocker.start_time})`);
      }
    }
  }
  parts.push('', '_To switch, contact Allocate+ with the preferred section code. This app surfaces options; the swap happens there._');
  return parts.join('\n');
}

function addMinutes(t, minsToAdd) {
  const [h, m] = t.split(':').map(Number);
  const total = h * 60 + m + minsToAdd;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function replyFacts(student) {
  const rows = db.prepare(`SELECT * FROM student_fact WHERE student_id = ?
    ORDER BY source ASC, category ASC, id DESC`).all(student.id);
  if (!rows.length) return 'I don\'t have anything saved about you yet. Use `/remember <fact>` to add one.';
  const byCat = {};
  for (const r of rows) (byCat[r.category] ??= []).push(r);
  const parts = ['**What I know about you**', '', '_Open `/facts.html` to edit or delete anything._', ''];
  for (const [cat, arr] of Object.entries(byCat)) {
    parts.push(`**${cat[0].toUpperCase() + cat.slice(1)}**`);
    for (const r of arr) {
      const badge = r.source === 'extracted' ? ' _(extracted)_' : '';
      parts.push(`- ${r.body}${badge} · \`id:${r.id}\``);
    }
    parts.push('');
  }
  return parts.join('\n');
}

function replyRemember(student, arg) {
  if (!arg) return 'Usage: `/remember <fact>` — for example `/remember I prefer concise answers` or `/remember My goal is HD average`.';
  const body = arg.trim().replace(/\s+/g, ' ').slice(0, 200);
  let category = 'other';
  if (/\b(prefer|like|hate|dislike|concise|detailed)\b/i.test(body)) category = 'preference';
  else if (/\b(goal|target|aim|aiming)\b/i.test(body)) category = 'goal';
  else if (/\b(schedule|work|shift|morning|night|evening)\b/i.test(body)) category = 'schedule';
  else if (/\b(study|studying|learner|course|subject)\b/i.test(body)) category = 'topic';
  else if (/\b(live|commute|from)\b/i.test(body)) category = 'context';
  const existing = db.prepare(`SELECT id FROM student_fact WHERE student_id = ? AND LOWER(body) = LOWER(?)`)
    .get(student.id, body);
  if (existing) {
    db.prepare(`UPDATE student_fact SET source='remember', confidence=1.0 WHERE id = ?`).run(existing.id);
    return `Already had that noted — I've promoted it to confirmed. \`id:${existing.id}\``;
  }
  const info = db.prepare(`INSERT INTO student_fact (student_id,category,body,source,confidence) VALUES (?,?,?, 'remember', 1.0)`)
    .run(student.id, category, body);
  return `Got it. I'll remember that.\n\n- Category: **${category}**\n- \`id:${info.lastInsertRowid}\`\n\nManage facts in \`/facts.html\` or type \`/forget ${info.lastInsertRowid}\` to remove.`;
}

function replyForget(student, arg) {
  if (!arg) return 'Usage: `/forget <id>` or `/forget <search text>` — e.g. `/forget 3` or `/forget visual learner`.';
  const asId = Number(arg.split(/\s+/)[0]);
  if (Number.isFinite(asId) && String(asId) === arg.trim()) {
    const r = db.prepare(`DELETE FROM student_fact WHERE id = ? AND student_id = ?`).run(asId, student.id);
    return r.changes ? `Removed fact \`id:${asId}\`.` : `No fact with \`id:${asId}\`.`;
  }
  const needle = `%${arg.toLowerCase()}%`;
  const rows = db.prepare(`SELECT * FROM student_fact WHERE student_id = ? AND LOWER(body) LIKE ?`).all(student.id, needle);
  if (!rows.length) return `Nothing matched "${arg}". Use \`/facts\` to list everything.`;
  if (rows.length > 1) return `Matched ${rows.length} facts. Pass an id instead:\n\n` + rows.map(r => `- \`${r.id}\` — ${r.body}`).join('\n');
  db.prepare(`DELETE FROM student_fact WHERE id = ?`).run(rows[0].id);
  return `Removed: "${rows[0].body}" \`id:${rows[0].id}\`.`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function parseWhen(str) {
  if (!str) return null;
  // ISO datetime
  const iso = new Date(str);
  if (!isNaN(iso.getTime()) && /\d{4}-\d{2}-\d{2}/.test(str)) return iso;

  const lower = str.toLowerCase();
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  const hourFromMatch = () => {
    if (!timeMatch) return { h: 9, m: 0 };
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (timeMatch[3] === 'pm' && h < 12) h += 12;
    if (timeMatch[3] === 'am' && h === 12) h = 0;
    return { h, m };
  };

  const base = new Date();
  base.setSeconds(0, 0);

  if (/^today\b/.test(lower)) {
    const { h, m } = hourFromMatch();
    base.setHours(h, m, 0, 0);
    return base;
  }
  if (/^tomorrow\b/.test(lower)) {
    base.setDate(base.getDate() + 1);
    const { h, m } = hourFromMatch();
    base.setHours(h, m, 0, 0);
    return base;
  }
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < 7; i++) {
    if (lower.startsWith(weekdays[i])) {
      const diff = (i - base.getDay() + 7) % 7 || 7;
      base.setDate(base.getDate() + diff);
      const { h, m } = hourFromMatch();
      base.setHours(h, m, 0, 0);
      return base;
    }
  }
  return null;
}

// ----- Start -----
const PORT = Number(process.env.PORT ?? 3000);
app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => app.log.info(`Unistudent PoC on http://localhost:${PORT}`))
  .catch(err => { app.log.error(err); process.exit(1); });
