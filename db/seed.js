import Database from 'better-sqlite3';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Deletes all data from every table in foreign-key-safe order.
// Schema (tables, indexes) is preserved. Used by the live demo reset endpoint.
export function clearAllData(db) {
  const tables = [
    'assessment',
    'nudge_dismissal',
    'conversation_message',
    'conversation_thread',
    'student_fact',
    'reminder',
    'timetable_session',
    'student_plan_entry',
    'student_component',
    'subject_offering',
    'subject_requisite',
    'component_subject',
    'component',
    'subject',
    'teaching_period',
    'course',
    'student',
  ];
  const hasSequence = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`
  ).get();
  const txn = db.transaction(() => {
    for (const t of tables) db.exec(`DELETE FROM ${t}`);
    if (hasSequence) {
      db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${tables.map(t => `'${t}'`).join(',')})`);
    }
  });
  txn();
}

export function insertSeedData(db) {
  // ----- Student -----
  const student = db.prepare(`INSERT INTO student
    (student_id, full_name, email, program_code, intake_period, year_level, is_international)
    VALUES (?,?,?,?,?,?,?)`).run(
    'S20183421','Alex Chen','alex.chen@uni.edu.au','BCS','SEM1-2024', 2, 0);
  const studentId = student.lastInsertRowid;

  // ----- Course -----
  db.prepare(`INSERT INTO course VALUES (?,?,?,?,?)`).run(
    'BCS','Bachelor of Computer Science', 360, 3, 'https://handbook.uni.edu.au/courses/bcs');

  // ----- Teaching periods -----
  const periods = [
    ['SEM1-2024','Semester 1 2024', 2024, 1, 'past',    '2024-02-26','2024-06-07'],
    ['SEM2-2024','Semester 2 2024', 2024, 2, 'past',    '2024-07-29','2024-11-08'],
    ['SEM1-2025','Semester 1 2025', 2025, 3, 'past',    '2025-02-24','2025-06-06'],
    ['SEM2-2025','Semester 2 2025', 2025, 4, 'past',    '2025-07-28','2025-11-07'],
    ['SEM1-2026','Semester 1 2026', 2026, 5, 'current', '2026-02-23','2026-06-05'],
    ['SEM2-2026','Semester 2 2026', 2026, 6, 'future',  '2026-07-27','2026-11-06'],
    ['SEM1-2027','Semester 1 2027', 2027, 7, 'future',  '2027-02-22','2027-06-04'],
    ['SEM2-2027','Semester 2 2027', 2027, 8, 'future',  '2027-07-26','2027-11-05'],
  ];
  const periodStmt = db.prepare(`INSERT INTO teaching_period VALUES (?,?,?,?,?,?,?)`);
  for (const p of periods) periodStmt.run(...p);

  // ----- Components -----
  const comp = db.prepare(`INSERT INTO component (course_code,type,title,credit_points) VALUES (?,?,?,?)`);
  const coreId      = comp.run('BCS','core','Computer Science Core', 180).lastInsertRowid;
  const majorSEId   = comp.run('BCS','major','Major: Software Engineering', 90).lastInsertRowid;
  const minorDSId   = comp.run('BCS','minor','Minor: Data Science', 45).lastInsertRowid;
  const electiveId  = comp.run('BCS','elective','Open Electives', 45).lastInsertRowid;

  db.prepare(`INSERT INTO student_component VALUES (?,?)`).run(studentId, coreId);
  db.prepare(`INSERT INTO student_component VALUES (?,?)`).run(studentId, majorSEId);
  db.prepare(`INSERT INTO student_component VALUES (?,?)`).run(studentId, minorDSId);
  db.prepare(`INSERT INTO student_component VALUES (?,?)`).run(studentId, electiveId);

  // ----- Subjects -----
  const subjects = [
    // Core
    ['CSE1001','Introduction to Programming', 15, coreId],
    ['CSE1002','Data Structures', 15, coreId],
    ['CSE1003','Discrete Mathematics', 15, coreId],
    ['CSE1004','Computer Systems', 15, coreId],
    ['CSE2001','Algorithms', 15, coreId],
    ['CSE2002','Database Systems', 15, coreId],
    ['CSE2003','Object-Oriented Design', 15, coreId],
    ['CSE2004','Operating Systems', 15, coreId],
    ['CSE3001','Computer Networks', 15, coreId],
    ['CSE3002','Software Project', 15, coreId],
    ['MAT1001','Calculus I', 15, coreId],
    ['MAT1002','Linear Algebra', 15, coreId],
    // Major: Software Engineering
    ['SWE2001','Software Engineering Principles', 15, majorSEId],
    ['SWE2002','Web Development', 15, majorSEId],
    ['SWE3001','Agile Methods & DevOps', 15, majorSEId],
    ['SWE3002','Software Architecture', 15, majorSEId],
    ['SWE3003','Quality Assurance & Testing', 15, majorSEId],
    ['SWE3004','Secure Software Engineering', 15, majorSEId],
    // Minor: Data Science
    ['DSC2001','Introduction to Data Science', 15, minorDSId],
    ['DSC3001','Machine Learning', 15, minorDSId],
    ['DSC3002','Data Visualisation', 15, minorDSId],
    // Electives (student's plan uses 3; extras stay in the catalogue)
    ['ELE2001','Professional Communication', 15, electiveId],
    ['ELE3001','Entrepreneurship & Innovation', 15, electiveId],
    ['ELE3002','Human-Computer Interaction', 15, electiveId],
    ['ELE2002','Philosophy of Technology', 15, electiveId],
    ['ELE2003','Climate & Sustainability', 15, electiveId],
    ['ELE3003','Digital Ethics', 15, electiveId],
    ['DSC3003','Statistical Inference', 15, minorDSId],
    ['DSC3004','Deep Learning', 15, minorDSId],
    ['SWE3005','Cloud Architecture', 15, majorSEId],
    ['SWE3006','DevSecOps', 15, majorSEId],
  ];

  const subjStmt = db.prepare(`INSERT INTO subject (code,title,credit_points,description,handbook_url) VALUES (?,?,?,?,?)`);
  const csStmt = db.prepare(`INSERT INTO component_subject VALUES (?,?)`);
  for (const [code, title, cp, componentId] of subjects) {
    subjStmt.run(code, title, cp, `${title} — introduces key concepts and practical applications.`,
      `https://handbook.uni.edu.au/subjects/${code.toLowerCase()}`);
    csStmt.run(componentId, code);
  }

  // ----- Requisites -----
  const req = db.prepare(`INSERT INTO subject_requisite VALUES (?,?,?)`);
  const prereqs = [
    ['CSE1002','CSE1001'],
    ['CSE2001','CSE1002'],
    ['CSE2001','CSE1003'],
    ['CSE2002','CSE1002'],
    ['CSE2003','CSE1002'],
    ['CSE2004','CSE1004'],
    ['CSE3001','CSE2004'],
    ['CSE3002','CSE2003'],
    ['MAT1002','MAT1001'],
    ['SWE2001','CSE1002'],
    ['SWE2002','CSE1002'],
    ['SWE3001','SWE2001'],
    ['SWE3002','SWE2001'],
    ['SWE3003','SWE2001'],
    ['SWE3004','CSE2004'],
    ['DSC3001','DSC2001'],
    ['DSC3001','MAT1002'],
    ['DSC3002','DSC2001'],
  ];
  for (const [s,r] of prereqs) req.run(s,r,'prerequisite');

  // ----- Offerings (all subjects offered Sem1 and Sem2 each future year) -----
  const off = db.prepare(`INSERT INTO subject_offering VALUES (?,?,?,?)`);
  for (const [code] of subjects) {
    for (const p of periods) {
      if (p[4] === 'past') continue;
      off.run(code, p[0], 'On Campus', 'City Campus');
    }
  }

  // ----- Student plan -----
  const plan = db.prepare(`INSERT INTO student_plan_entry
    (student_id,subject_code,teaching_period,status,grade) VALUES (?,?,?,?,?)`);
  const completed = [
    ['CSE1001','SEM1-2024','HD'],
    ['CSE1003','SEM1-2024','D'],
    ['MAT1001','SEM1-2024','C'],
    ['ELE2001','SEM1-2024','D'],
    ['CSE1002','SEM2-2024','D'],
    ['CSE1004','SEM2-2024','C'],
    ['MAT1002','SEM2-2024','C'],
    ['DSC2001','SEM2-2024','D'],
    ['CSE2001','SEM1-2025','C'],
    ['CSE2003','SEM1-2025','D'],
    ['SWE2001','SEM1-2025','HD'],
    ['SWE2002','SEM1-2025','D'],
    ['CSE2002','SEM2-2025','D'],
    ['CSE2004','SEM2-2025','C'],
    ['SWE3001','SEM2-2025','HD'],
    ['DSC3001','SEM2-2025','D'],
  ];
  for (const [c,p,g] of completed) plan.run(studentId, c, p, 'completed', g);

  // Currently enrolled — SEM1-2026
  for (const c of ['CSE3001','SWE3002','SWE3003','DSC3002']) {
    plan.run(studentId, c, 'SEM1-2026','enrolled', null);
  }

  // Planned — future semesters
  const planned = [
    ['CSE3002','SEM2-2026'],
    ['SWE3004','SEM2-2026'],
  ];
  for (const [c,p] of planned) plan.run(studentId, c, p, 'planned', null);

  // ----- Timetable sessions for enrolled subjects (SEM1-2026) -----
  const ts = db.prepare(`INSERT INTO timetable_session
    (subject_code,teaching_period,activity_type,day_of_week,start_time,duration_min,location,delivery_mode,section_code,is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const sessions = [
    // Mon — CSE3001 Tutorial intentionally overlaps SWE3002 Lecture (demo clash)
    ['CSE3001','SEM1-2026','Lecture',    1,'09:00', 90, 'Eng Building 2.14','On Campus', null, 1],
    ['SWE3002','SEM1-2026','Lecture',    1,'11:00', 90, 'Eng Building 1.01','On Campus', null, 1],
    ['CSE3001','SEM1-2026','Tutorial',   1,'11:30', 60, 'Lab Block 3.02','On Campus', 'T01', 1],
    // Tue
    ['SWE3003','SEM1-2026','Lecture',    2,'10:00', 90, 'Eng Building 2.14','On Campus', null, 1],
    ['DSC3002','SEM1-2026','Lecture',    2,'13:00', 90, 'Science 4.11','On Campus', null, 1],
    ['SWE3002','SEM1-2026','Workshop',   2,'15:00',120, 'Lab Block 2.05','On Campus', 'W01', 1],
    // Wed
    ['DSC3002','SEM1-2026','Lab',        3,'10:00',120, 'Data Lab 1.03','On Campus', 'L01', 1],
    ['SWE3003','SEM1-2026','Tutorial',   3,'14:00', 60, 'Eng Building 1.12','On Campus', 'T01', 1],
    // Thu
    ['CSE3001','SEM1-2026','Lab',        4,'09:00',120, 'Network Lab 2.01','On Campus', 'L01', 1],
    ['SWE3002','SEM1-2026','Tutorial',   4,'13:00', 60, 'Eng Building 3.05','On Campus', 'T01', 1],
    // Fri
    ['SWE3003','SEM1-2026','Workshop',   5,'10:00',120, 'Lab Block 2.05','On Campus', 'W01', 1],

    // ---- Alternate sections (is_active=0) ----
    ['CSE3001','SEM1-2026','Tutorial',   3,'15:00', 60, 'Lab Block 3.02','On Campus', 'T02', 0],
    ['CSE3001','SEM1-2026','Tutorial',   4,'11:00', 60, 'Lab Block 3.02','On Campus', 'T03', 0],
    ['CSE3001','SEM1-2026','Tutorial',   2,'10:30', 60, 'Lab Block 3.02','On Campus', 'T04', 0],
    ['CSE3001','SEM1-2026','Lab',        5,'13:00',120, 'Network Lab 2.01','On Campus', 'L02', 0],
    ['CSE3001','SEM1-2026','Lab',        3,'09:00',120, 'Network Lab 2.01','On Campus', 'L03', 0],
    ['SWE3002','SEM1-2026','Workshop',   4,'14:00',120, 'Lab Block 2.05','On Campus', 'W02', 0],
    ['SWE3002','SEM1-2026','Workshop',   3,'11:00',120, 'Lab Block 2.05','On Campus', 'W03', 0],
    ['SWE3002','SEM1-2026','Tutorial',   5,'13:00', 60, 'Eng Building 3.05','On Campus', 'T02', 0],
    ['SWE3002','SEM1-2026','Tutorial',   2,'10:00', 60, 'Eng Building 3.05','On Campus', 'T03', 0],
    ['SWE3003','SEM1-2026','Tutorial',   4,'15:00', 60, 'Eng Building 1.12','On Campus', 'T02', 0],
    ['SWE3003','SEM1-2026','Tutorial',   5,'13:00', 60, 'Eng Building 1.12','On Campus', 'T03', 0],
    ['SWE3003','SEM1-2026','Workshop',   3,'10:00',120, 'Lab Block 2.05','On Campus', 'W02', 0],
    ['SWE3003','SEM1-2026','Workshop',   4,'15:00',120, 'Lab Block 2.05','On Campus', 'W03', 0],
    ['DSC3002','SEM1-2026','Lab',        4,'14:00',120, 'Data Lab 1.03','On Campus', 'L02', 0],
    ['DSC3002','SEM1-2026','Lab',        5,'14:00',120, 'Data Lab 1.03','On Campus', 'L03', 0],
  ];
  for (const s of sessions) ts.run(...s);

  // ----- Reminders -----
  const rem = db.prepare(`INSERT INTO reminder
    (student_id,title,due_at,kind,subject_code) VALUES (?,?,?,?,?)`);
  const reminders = [
    ['CSE3001 — Assignment 1 (Routing Protocols)', '2026-04-22T23:59','assessment','CSE3001'],
    ['SWE3002 — Architecture Design Document',     '2026-04-24T17:00','assessment','SWE3002'],
    ['DSC3002 — Visualisation Critique',           '2026-04-28T23:59','assessment','DSC3002'],
    ['SWE3003 — Test Plan Submission',             '2026-05-03T23:59','assessment','SWE3003'],
    ['Review lecture notes: CSE3001 Week 6',       '2026-04-19T18:00','study','CSE3001'],
    ['SEM2-2026 enrolment opens',                   '2026-05-12T09:00','enrolment', null],
    ['Meet academic advisor — pathway review',     '2026-04-30T14:00','advisor', null],
  ];
  const reminderIdByTitle = {};
  for (const r of reminders) {
    const info = rem.run(studentId, ...r);
    reminderIdByTitle[r[0]] = info.lastInsertRowid;
  }

  // ----- Assessments -----
  const assess = db.prepare(`INSERT INTO assessment
    (student_id, subject_code, title, weight_pct, due_at, score_pct, reminder_id)
    VALUES (?,?,?,?,?,?,?)`);
  const assessments = [
    ['CSE3001','Quiz 1 (Transport Layer)',       10, '2026-03-24T10:00', 82,   null],
    ['CSE3001','Assignment 1 (Routing Protocols)', 30, '2026-04-22T23:59', null, reminderIdByTitle['CSE3001 — Assignment 1 (Routing Protocols)']],
    ['CSE3001','Assignment 2 (Congestion Control)', 25, '2026-05-16T23:59', null, null],
    ['CSE3001','Final Exam',                     35, '2026-06-15T09:00', null, null],
    ['SWE3002','Midsem Quiz',                    15, '2026-03-30T10:00', 88,   null],
    ['SWE3002','Architecture Design Document',   35, '2026-04-24T17:00', null, reminderIdByTitle['SWE3002 — Architecture Design Document']],
    ['SWE3002','Peer Architecture Review',       15, '2026-05-20T23:59', null, null],
    ['SWE3002','Final Exam',                     35, '2026-06-12T09:00', null, null],
    ['SWE3003','Lab Portfolio 1',                10, '2026-03-20T23:59', 75,   null],
    ['SWE3003','Lab Portfolio 2',                10, '2026-04-10T23:59', 80,   null],
    ['SWE3003','Test Plan Submission',           30, '2026-05-03T23:59', null, reminderIdByTitle['SWE3003 — Test Plan Submission']],
    ['SWE3003','Final Exam',                     50, '2026-06-10T14:00', null, null],
    ['DSC3002','Weekly Critique 1',              10, '2026-03-17T23:59', 70,   null],
    ['DSC3002','Visualisation Critique',         25, '2026-04-28T23:59', null, reminderIdByTitle['DSC3002 — Visualisation Critique']],
    ['DSC3002','Dashboard Project',              40, '2026-05-25T23:59', null, null],
    ['DSC3002','Viva Presentation',              25, '2026-06-08T10:00', null, null],
  ];
  for (const [code, title, weight, due, score, remId] of assessments) {
    assess.run(studentId, code, title, weight, due, score, remId);
  }

  // ----- Default conversation thread -----
  db.prepare(`INSERT INTO conversation_thread (student_id,title) VALUES (?, ?)`).run(studentId, 'Inbox');

  // ----- A few seed facts so the /facts page isn't empty -----
  const fact = db.prepare(`INSERT INTO student_fact (student_id,category,body,source,confidence) VALUES (?,?,?,?,?)`);
  fact.run(studentId, 'preference', 'Prefers concise explanations with worked examples',       'remember',  1.0);
  fact.run(studentId, 'schedule',   'Works part-time Tuesday and Thursday evenings',            'remember',  1.0);
  fact.run(studentId, 'goal',       'Aiming for Distinction average in Year 3',                 'remember',  1.0);
  fact.run(studentId, 'context',    'Visual learner — prefers diagrams over long prose',        'extracted', 0.7);
  fact.run(studentId, 'topic',      'Struggled with dynamic programming in CSE2001',            'extracted', 0.6);

  return {
    subjects: subjects.length,
    planEntries: db.prepare('SELECT COUNT(*) c FROM student_plan_entry').get().c,
    sessions: sessions.length,
    reminders: reminders.length,
    assessments: assessments.length,
    facts: 5,
  };
}

// Run as a CLI script: rebuild the DB file from scratch so schema changes apply.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dbPath = join(__dirname, 'data.sqlite');
  if (existsSync(dbPath)) unlinkSync(dbPath);
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  const stats = insertSeedData(db);
  console.log('Seeded:', { student: 1, ...stats, threads: 1 });
  db.close();
}
