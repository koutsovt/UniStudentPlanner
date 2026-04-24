import { api, el, initShell, formatDue, DAY_NAMES } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'dashboard', crumb: 'Overview' });
mountAgentDock({ context: 'dashboard' });

const page = document.getElementById('page');
const [data, nudgesRes] = await Promise.all([
  api.get('/api/dashboard'),
  api.get('/api/nudges'),
]);
const today = new Date();
const c = data.credits;
const pctCompleted = (c.completed / c.total) * 100;
const pctEnrolled  = (c.enrolled  / c.total) * 100;
const pctPlanned   = (c.planned   / c.total) * 100;

// Page head
page.appendChild(el('div', { class: 'page-head' }, [
  el('h1', { class: 'page-title', html: 'Your study <span class="it">overview</span>' }),
  el('div', { class: 'page-sub' },
    today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
    ' — live snapshot of your progress, classes, and deadlines sourced from SISOne via SAP PI/PO.'),
  el('div', { class: 'page-meta' }, [
    metaItem('Course', data.course.title),
    metaItem('Credit points', `${c.completed}/${c.total}`, 'BR04-09'),
    metaItem('GPA', data.gpa != null ? data.gpa.toFixed(2) : '—', 'BR04-08'),
    metaItem('Status', data.gpa != null && data.gpa >= 2.0 ? 'On track' : 'Review',
      null, data.gpa != null && data.gpa >= 2.0 ? 'ok' : 'warn'),
  ]),
]));

function metaItem(label, value, br, cls) {
  return el('div', {}, [
    el('span', { class: 'k' }, label),
    el('span', { class: `v${cls ? ' ' + cls : ''}`, html: value + (br ? ` <span class="br-tag">${br}</span>` : '') }),
  ]);
}

// Proactive nudges (dismissible, persisted)
const nudgesHost = el('div', { class: 'nudges', id: 'nudges-host' });
page.appendChild(nudgesHost);
renderNudges(nudgesRes.nudges);

document.addEventListener('agent:mutated', async () => {
  try {
    const res = await api.get('/api/nudges');
    renderNudges(res.nudges);
  } catch {}
});

function renderNudges(list) {
  nudgesHost.innerHTML = '';
  if (!list.length) return;
  nudgesHost.appendChild(el('div', { class: 'nudges-head' }, [
    el('span', { class: 'nudges-title' }, 'For you'),
    el('span', { class: 'nudges-sub' }, `${list.length} suggestion${list.length === 1 ? '' : 's'} based on your plan and timetable`),
  ]));
  const grid = el('div', { class: 'nudges-grid' });
  for (const n of list) {
    const card = el('div', { class: `nudge nudge-${n.kind}` }, [
      el('div', { class: 'nudge-icon' }, nudgeGlyph(n.icon)),
      el('div', { class: 'nudge-body' }, [
        el('div', { class: 'nudge-title' }, n.title),
        el('div', { class: 'nudge-text' }, n.body),
        el('div', { class: 'nudge-actions' }, [
          n.action_url ? el('a', { class: 'nudge-btn', href: n.action_url }, n.action_label ?? 'Open') : null,
          el('button', {
            class: 'nudge-btn nudge-btn-ghost', type: 'button',
            onclick: async () => {
              await api.post('/api/nudges/dismiss', { key: n.key });
              card.remove();
              if (!nudgesHost.querySelector('.nudge')) nudgesHost.innerHTML = '';
            },
          }, 'Dismiss'),
        ]),
      ]),
    ]);
    grid.appendChild(card);
  }
  nudgesHost.appendChild(grid);
}

function nudgeGlyph(kind) {
  const glyphs = {
    alert: '!',
    gap:   '△',
    load:  '⊞',
    study: '◐',
  };
  return glyphs[kind] ?? '•';
}

// 4 prog-stats
const progTop = el('div', { class: 'prog-top' }, [
  progStat('Credit points',   `${c.completed}`, `/ ${c.total}`,
    `${Math.round(pctCompleted)}% complete · ${c.total - c.completed - c.enrolled - c.planned} remaining`),
  progStat('Currently enrolled', `${c.enrolled}`, ' cp',
    'Semester 1, 2026 active subjects'),
  progStat('Planned',          `${c.planned}`, ' cp',
    'Future semesters, draft plan'),
  progStat('Next deadline',
    data.upcoming[0] ? shortDue(data.upcoming[0].due_at) : '—', '',
    data.upcoming[0]?.title ?? 'Nothing upcoming'),
]);
page.appendChild(progTop);

function progStat(label, value, unit, trendTxt) {
  return el('div', { class: 'prog-stat' }, [
    el('div', { class: 'k' }, label),
    el('div', { class: 'v', html: `${value}<span class="u">${unit}</span>` }),
    el('div', { class: 'tr' }, trendTxt),
  ]);
}
function shortDue(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Hero progress card + Today's classes + Upcoming
const grid = el('div', { class: 'dash-grid' }, [todayCard(), upcomingCard()]);
page.appendChild(grid);

function todayCard() {
  const classes = data.todayClasses;
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, [
        `Today · ${DAY_NAMES[today.getDay()]}`,
        el('span', { class: 'br-tag' }, 'BR02-16'),
      ]),
      el('a', { class: 'rt', href: '/timetable.html' }, 'Full week →'),
    ]),
    el('div', { class: 'card-bd flush', id: 'today-body' }),
  ]);
  const body = card.querySelector('#today-body');
  if (!classes.length) {
    body.appendChild(el('div', { style: 'padding:32px 18px;text-align:center;color:var(--muted);font-size:12.5px' },
      'No classes scheduled today.'));
    return card;
  }
  for (const cls of classes) {
    body.appendChild(el('div', {
      class: 'ev-row',
      style: 'border:0;border-bottom:1px solid var(--border);border-radius:0;margin-bottom:0',
    }, [
      el('div', { class: 'tm' }, [
        cls.start_time,
        el('small', {}, endTime(cls.start_time, cls.duration_min)),
      ]),
      el('div', { class: 'info' }, [
        el('div', { class: 'l1' }, [
          el('span', { class: 'c' }, cls.subject_code),
          el('span', { class: 'n' }, cls.title),
        ]),
        el('div', { class: 'l2' }, [
          el('span', {}, cls.location),
          el('span', {}, cls.delivery_mode),
        ]),
      ]),
      el('span', { class: `type-p ${cls.activity_type.toLowerCase()}` }, cls.activity_type),
    ]));
  }
  return card;
}

function endTime(start, durMin) {
  const [h, m] = start.split(':').map(Number);
  const end = h * 60 + m + durMin;
  return `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;
}

function upcomingCard() {
  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, [
        'Upcoming',
        el('span', { class: 'br-tag' }, 'BR05-02'),
      ]),
      el('a', { class: 'rt', href: '/reminders.html' }, 'All reminders →'),
    ]),
    el('div', { class: 'card-bd' }),
  ]);
  const body = card.querySelector('.card-bd');
  if (!data.upcoming.length) {
    body.appendChild(el('div', { class: 'muted small' }, 'Nothing upcoming.'));
    return card;
  }
  for (const r of data.upcoming) {
    body.appendChild(el('div', { class: `notif-item ${r.kind}` }, [
      el('div', { class: 'tt' }, r.title),
      el('div', {}, [
        el('span', { class: `kind-pill ${r.kind}`, style: 'margin-right:8px' }, r.kind),
        formatDue(r.due_at),
      ]),
      r.subject_code ? el('div', { class: 'mt' }, r.subject_code) : null,
    ]));
  }
  return card;
}
