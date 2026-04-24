import { api, el, initShell, avatar, toast, humanPeriod, THEMES, applyTheme, currentTheme } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'settings', crumb: 'Settings' });
mountAgentDock({ context: 'settings' });

const page = document.getElementById('page');
const student = await api.get('/api/student');

page.appendChild(el('div', { class: 'page-head' }, [
  el('h1', { class: 'page-title', html: 'Your <span class="it">settings</span>' }),
  el('div', { class: 'page-sub' },
    'Profile, appearance, and privacy controls. Student details flow from SISOne via SAP PI/PO and are read-only here — contact Student Advising to correct any inaccuracy.'),
]));

const layout = el('div', { class: 'settings-layout' });

// Section nav (sticky, left)
const nav = el('nav', { class: 'settings-nav' });
const sections = [
  { id: 'profile',    label: 'Profile' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'academic',   label: 'Academic' },
  { id: 'privacy',    label: 'Privacy & data' },
];
for (const s of sections) {
  nav.appendChild(el('a', {
    class: 'settings-nav-link',
    href: '#' + s.id,
    onclick: (e) => {
      nav.querySelectorAll('.settings-nav-link.active').forEach(x => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
    },
  }, s.label));
}
nav.firstElementChild.classList.add('active');
layout.appendChild(nav);

const col = el('div', { class: 'settings-col' });

// ──────────── Profile ────────────
col.appendChild(renderProfile(student));

// ──────────── Appearance ────────────
col.appendChild(renderAppearance());

// ──────────── Academic ────────────
col.appendChild(renderAcademic(student));

// ──────────── Privacy & data ────────────
col.appendChild(renderPrivacy());

// ──────────── Demo (only when UNISTUDENT_DEMO=1) ────────────
const demoStatus = await api.get('/api/demo/status').catch(() => ({ enabled: false }));
if (demoStatus.enabled) {
  nav.appendChild(el('a', {
    class: 'settings-nav-link',
    href: '#demo',
    onclick: (e) => {
      nav.querySelectorAll('.settings-nav-link.active').forEach(x => x.classList.remove('active'));
      e.currentTarget.classList.add('active');
    },
  }, 'Demo'));
  col.appendChild(renderDemo());
}

layout.appendChild(col);
page.appendChild(layout);

// ─── Section renderers ───────────────────────────────────────

function renderProfile(s) {
  const card = el('section', { class: 'card settings-section', id: 'profile' });
  card.appendChild(el('div', { class: 'card-hd' }, [
    el('h3', {}, 'Profile'),
    el('span', { class: 'rt' }, 'Sourced from SISOne'),
  ]));
  const body = el('div', { class: 'card-bd' });
  body.appendChild(el('div', { class: 'profile-head' }, [
    avatar(s, 72),
    el('div', { style: 'min-width:0' }, [
      el('div', { class: 'profile-name' }, s.full_name),
      el('div', { class: 'profile-id mono', style: 'color:var(--muted)' }, s.student_id),
      el('div', { class: 'profile-email' }, s.email),
    ]),
  ]));
  body.appendChild(el('dl', { class: 'settings-dl' }, [
    settingsRow('Full name',       s.full_name),
    settingsRow('Student number',  s.student_id, true),
    settingsRow('Email',           s.email),
    settingsRow('Program',         `${s.program_code} — Bachelor of Computer Science`),
    settingsRow('Year of study',   `Year ${s.year_level}`),
    settingsRow('Intake',          humanPeriod(s.intake_period)),
    settingsRow('Student type',    s.is_international ? 'International' : 'Domestic'),
    settingsRow('Components',      s.components.map(c => c.title).join(' · '), false, 'multiline'),
  ]));
  body.appendChild(el('div', { class: 'settings-note' }, [
    'Need a change? Contact ',
    el('a', { class: 'inline-link', href: '#', onclick: (e) => { e.preventDefault(); toast('Would deep-link to ASK La Trobe'); } }, 'ASK La Trobe'),
    ' or Student Advising. The Study Planner reads from SISOne and cannot modify these fields.',
  ]));
  card.appendChild(body);
  return card;
}

function renderAppearance() {
  const card = el('section', { class: 'card settings-section', id: 'appearance' });
  card.appendChild(el('div', { class: 'card-hd' }, [el('h3', {}, 'Appearance')]));
  const body = el('div', { class: 'card-bd' });

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'Theme'),
      el('div', { class: 'setting-help' }, 'Light, dark, or follow your operating system. Also available as a toggle in the top bar.'),
    ]),
    el('div', { class: 'setting-control' }, [renderThemeOptions()]),
  ]));

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'Reduced motion'),
      el('div', { class: 'setting-help' }, 'Respects your OS preference. When reduced motion is enabled, transitions and decorative animations are disabled.'),
    ]),
    el('div', { class: 'setting-control' }, [
      el('span', { class: 'chip' }, 'System-controlled'),
    ]),
  ]));
  card.appendChild(body);
  return card;
}

function renderThemeOptions() {
  const wrap = el('div', { class: 'theme-options' });
  const labels = { light: 'Light', dark: 'Dark', auto: 'Auto' };
  const syncAll = () => {
    for (const c of wrap.children) {
      c.classList.toggle('on', c.dataset.themeValue === currentTheme());
    }
    // Also update topbar segmented control if present
    document.querySelectorAll('.theme-toggle .theme-btn').forEach(b => {
      b.classList.toggle('on', b.dataset.themeValue === currentTheme());
    });
  };
  for (const t of THEMES) {
    wrap.appendChild(el('button', {
      type: 'button',
      class: 'theme-opt' + (currentTheme() === t ? ' on' : ''),
      'data-theme-value': t,
      onclick: () => { applyTheme(t); syncAll(); },
    }, [
      el('span', { class: 'theme-opt-swatch theme-opt-' + t }),
      el('span', {}, labels[t]),
    ]));
  }
  return wrap;
}

function renderAcademic(s) {
  const card = el('section', { class: 'card settings-section', id: 'academic' });
  card.appendChild(el('div', { class: 'card-hd' }, [
    el('h3', {}, 'Academic'),
    el('span', { class: 'rt' }, 'Current enrolment'),
  ]));
  const body = el('div', { class: 'card-bd' });
  body.appendChild(el('dl', { class: 'settings-dl' }, [
    settingsRow('Current semester', 'Semester 1, 2026'),
    settingsRow('Academic advisor', 'Dr Emma Hart — Senior Advisor'),
    settingsRow('Expected graduation', 'Semester 2, 2027'),
    settingsRow('Enrolment status', 'Full-time'),
    settingsRow('Load', '60 credit points per semester'),
  ]));
  body.appendChild(el('div', { class: 'settings-note' },
    'Advisor relationships and enrolment status flow from SISOne. Re-allocation and plan approval live in Allocate+ and the Plan my degree page.'));
  card.appendChild(body);
  return card;
}

function renderPrivacy() {
  const card = el('section', { class: 'card settings-section', id: 'privacy' });
  card.appendChild(el('div', { class: 'card-hd' }, [el('h3', {}, 'Privacy & data')]));
  const body = el('div', { class: 'card-bd' });

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'What I know about you'),
      el('div', { class: 'setting-help' }, 'Review, edit, and delete facts the agent has stored about you — both confirmed and auto-extracted.'),
    ]),
    el('div', { class: 'setting-control' }, [
      el('a', { class: 'btn outline sm', href: '/facts.html' }, 'Open facts →'),
    ]),
  ]));

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'Dismissed suggestions'),
      el('div', { class: 'setting-help' }, 'Proactive nudges you have dismissed stay hidden. Reset to see them again on the Overview page.'),
    ]),
    el('div', { class: 'setting-control' }, [
      el('button', {
        class: 'btn outline sm', type: 'button',
        onclick: async () => {
          if (!confirm('Reset all dismissed nudges?')) return;
          await api.post('/api/nudges/reset', {});
          toast('Dismissed suggestions reset', 'success');
        },
      }, 'Reset dismissed'),
    ]),
  ]));

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'Conversation history'),
      el('div', { class: 'setting-help' }, 'Clears messages across all threads. Threads themselves are preserved so you can keep using them.'),
    ]),
    el('div', { class: 'setting-control' }, [
      el('button', {
        class: 'btn outline sm btn-danger', type: 'button',
        onclick: async () => {
          if (!confirm('Clear all conversation history? This affects every thread (Inbox and any named threads).')) return;
          await api.del('/api/agent/messages');
          toast('Conversation history cleared', 'success');
        },
      }, 'Clear conversations'),
    ]),
  ]));

  body.appendChild(el('div', { class: 'settings-note' },
    'Your data is visible only to you. FERPA / GDPR requests (export, full deletion) are handled by Student Advising.'));
  card.appendChild(body);
  return card;
}

function renderDemo() {
  const card = el('section', { class: 'card settings-section', id: 'demo' });
  card.appendChild(el('div', { class: 'card-hd' }, [
    el('h3', {}, 'Demo'),
    el('span', { class: 'rt' }, 'Dev only'),
  ]));
  const body = el('div', { class: 'card-bd' });

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'Reset demo data'),
      el('div', { class: 'setting-help' },
        'Wipes the database and re-runs the seed. Use between demo run-throughs to reset Alex\'s state — including any swapped timetable sections, mark changes, and added assessments.'),
    ]),
    el('div', { class: 'setting-control' }, [
      el('button', {
        class: 'btn pri sm', type: 'button',
        onclick: async () => {
          if (!confirm('Reset all demo data? Every non-schema row will be wiped and re-seeded.')) return;
          try {
            const stats = await api.post('/api/demo/reset', {});
            toast(`Reset — ${stats.assessments} assessments, ${stats.sessions} sessions`, 'success');
            setTimeout(() => location.reload(), 400);
          } catch (e) { toast(e.message, 'error'); }
        },
      }, 'Reset now'),
    ]),
  ]));

  body.appendChild(el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-text' }, [
      el('div', { class: 'setting-label' }, 'Demo script'),
      el('div', { class: 'setting-help' },
        '1. Overview — spot the clash & upcoming deadline nudges. ' +
        '2. Timetable — click "Swap section" on the CSE3001 Tutorial, apply T02, watch the clash clear. ' +
        '3. Progress — expand CSE3001, drag the "Assignment 1" what-if slider to 90%, see expected % jump to HD. ' +
        '4. Timetable — "Export to calendar" downloads the .ics. ' +
        '5. Agent dock — /forecast SWE3003 for a one-liner. ' +
        '6. Back here, reset to replay.'),
    ]),
  ]));

  card.appendChild(body);
  return card;
}

function settingsRow(label, value, copyable = false, modifier = '') {
  return el('div', { class: `settings-dt-dd ${modifier}` }, [
    el('dt', {}, label),
    el('dd', {}, copyable ? el('span', { class: 'mono' }, value) : String(value)),
  ]);
}
