import { api, el, initShell, humanPeriod, DAY_ABBR, DAY_NAMES, toast } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'timetable', crumb: 'Timetable' });
mountAgentDock({ context: 'timetable' });
const page = document.getElementById('page');

const data = await api.get('/api/timetable');

page.appendChild(el('div', { class: 'page-head' }, [
  el('h1', { class: 'page-title', html: 'Your <span class="it">timetable</span>' }),
  el('div', { class: 'page-sub' },
    data.period ? `Confirmed weekly schedule for ${humanPeriod(data.period.code)} — sourced from Allocate+ via SAP PI/PO. ` : '',
    'Export to calendar, subscribe to a live feed, or view day-by-day.'),
]));

if (!data.period || !data.sessions.length) {
  page.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-bd', style: 'padding:32px;text-align:center;color:var(--muted);font-size:13px' },
      'No enrolled subjects in the current teaching period.'),
  ]));
} else {
  if (data.clashes.length) {
    const byId = Object.create(null);
    for (const s of data.sessions) byId[s.id] = s;
    const firstCode = byId[data.clashes[0].a]?.subject_code ?? '';
    page.appendChild(el('div', { class: 'alert warn mb-4' }, [
      el('div', { class: 'ai' }, '!'),
      el('div', {}, [
        el('div', { class: 'bold' }, `${data.clashes.length} timetable clash${data.clashes.length === 1 ? '' : 'es'} this semester`),
        el('div', { class: 'small mt-1' }, [
          'Clashing sessions are highlighted below. ',
          el('a', {
            href: '#', class: 'inline-link',
            onclick: (e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('agent:prefill', { detail: { text: `/resolve ${firstCode}` } }));
            },
          }, 'Ask the agent for options →'),
        ]),
      ]),
    ]));
  }
  const tt = el('div', { class: 'tt-layout' });

  const leftCol = el('div', {});
  leftCol.appendChild(renderHero(data));
  renderDayGroups(leftCol, data);
  tt.appendChild(leftCol);

  const rightCol = el('aside', {});
  rightCol.appendChild(renderMiniCal(data));
  rightCol.appendChild(renderNotifs());
  rightCol.appendChild(renderSubscribe());
  tt.appendChild(rightCol);

  page.appendChild(tt);

  page.appendChild(el('div', { class: 'legend mt-4' }, [
    el('span', { html: '<span class="sw sw-lec"></span>Lecture' }),
    el('span', { html: '<span class="sw sw-tut"></span>Tutorial' }),
    el('span', { html: '<span class="sw sw-prac"></span>Practical / Workshop / Lab' }),
    el('span', { html: '<span class="sw sw-clash"></span>Clash' }),
    el('span', { style: 'margin-left:auto;font-family:var(--mono);color:var(--muted);font-size:10px' },
      'Tap a session for details · times are local'),
  ]));
}

function renderHero(data) {
  const today = new Date();
  const dow = today.getDay();
  // Find next upcoming session today or this week
  const now = today.getHours() * 60 + today.getMinutes();
  const upcomingToday = data.sessions
    .filter(s => s.day_of_week === dow && toMin(s.start_time) > now)
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  const nextWeek = data.sessions
    .filter(s => s.day_of_week > dow || (s.day_of_week === dow && toMin(s.start_time) > now))
    .sort((a, b) => (a.day_of_week - b.day_of_week) || (toMin(a.start_time) - toMin(b.start_time)));
  const next = upcomingToday[0] ?? nextWeek[0] ?? data.sessions[0];

  const minsAway = next.day_of_week === dow ? toMin(next.start_time) - now : null;
  const eb = minsAway != null && minsAway > 0 && minsAway < 240
    ? `Up next · in ${minsAway >= 60 ? Math.round(minsAway/60) + ' hours' : minsAway + ' minutes'}`
    : `Next class · ${DAY_NAMES[next.day_of_week]}`;

  return el('div', { class: 'tt-hero' }, [
    el('div', { class: 'eb' }, eb),
    el('h3', {}, `${next.subject_code} ${next.activity_type}`),
    el('div', { class: 'when' }, `${DAY_NAMES[next.day_of_week]} · ${next.start_time} – ${endTime(next.start_time, next.duration_min)} · ${next.title}`),
    el('div', { class: 'quick' }, [
      quickCell('Room', next.location),
      quickCell('Mode', next.delivery_mode),
      quickCell('Duration', `${next.duration_min} min`),
      quickCell('Week', `Week ${Math.ceil((today.getDate()) / 7)}`),
    ]),
    el('div', { class: 'cta' }, [
      el('button', { class: 'btn', onclick: () => alert('Would open directions to ' + next.location) }, 'Get directions'),
      el('button', { class: 'btn', onclick: () => alert('Would open LMS course page') }, 'Open in LMS'),
      el('button', { class: 'btn', onclick: () => { window.location.href = '/api/calendar.ics'; } }, 'Export to calendar'),
    ]),
  ]);

  function quickCell(k, v) {
    return el('div', { class: 'q' }, [el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)]);
  }
}

function renderDayGroups(host, data) {
  const today = new Date().getDay();
  const clashIds = new Set();
  for (const c of data.clashes) { clashIds.add(c.a); clashIds.add(c.b); }
  const byDay = {};
  for (const s of data.sessions) (byDay[s.day_of_week] ??= []).push(s);
  for (const d of Object.keys(byDay)) byDay[d].sort((a, b) => a.start_time.localeCompare(b.start_time));

  const weekDates = weekDatesArr();
  for (let d = 1; d <= 5; d++) {
    const grp = el('div', { class: 'day-group' });
    grp.appendChild(el('h4', { class: 'dh' + (d === today ? ' today' : '') }, [
      DAY_NAMES[d],
      el('span', { class: 'dt' }, `${weekDates[d]}${d === today ? ' · today' : ''}`),
    ]));
    const list = byDay[d] ?? [];
    if (!list.length) {
      grp.appendChild(el('div', { style: 'font-size:12px;color:var(--muted);padding:6px 2px' }, 'No classes'));
    } else {
      for (const s of list) {
        const isClash = clashIds.has(s.id);
        const isNow = d === today && isCurrentSlot(s);
        const t = s.activity_type.toLowerCase();
        const partner = isClash ? findClashPartner(s, data) : null;
        const canSwap = isClash && s.activity_type !== 'Lecture';
        const swapPanel = el('div', { class: 'swap-panel', style: 'display:none' });
        const ev = el('div', {
          class: `ev-row${isNow ? ' now' : ''}${isClash ? ' clash' : ''}`,
        }, [
          el('div', { class: 'tm' }, [
            s.start_time,
            el('small', {}, endTime(s.start_time, s.duration_min)),
          ]),
          el('div', { class: 'info' }, [
            el('div', { class: 'l1' }, [
              el('span', { class: 'c' }, s.subject_code),
              el('span', { class: 'n' }, s.title),
              isNow ? el('span', { class: 'now-badge' }, 'Up next') : null,
            ]),
            el('div', { class: 'l2' }, [
              el('span', {}, s.location),
              el('span', {}, s.delivery_mode),
              isClash && partner ? el('span', { style: 'color:var(--red);font-weight:600' },
                `Overlaps ${partner.subject_code} ${partner.activity_type}`) : null,
            ]),
          ]),
          canSwap
            ? el('button', {
                class: 'btn sm outline clash-resolve',
                onclick: () => toggleSwapPanel(s, swapPanel),
              }, 'Swap section')
            : isClash
              ? el('span', { class: 'small', style: 'color:var(--muted)' }, 'Lecture — not swappable')
              : el('span', { class: `type-p ${t}` }, s.activity_type),
        ]);
        grp.appendChild(ev);
        grp.appendChild(swapPanel);
      }
    }
    host.appendChild(grp);
  }
}

async function toggleSwapPanel(session, panel) {
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.innerHTML = '';
  panel.style.display = 'block';
  panel.appendChild(el('div', { class: 'small muted', style: 'padding:8px 12px' }, 'Loading alternates…'));
  try {
    const data = await api.get(`/api/timetable/alternates/${session.id}`);
    panel.innerHTML = '';
    panel.appendChild(renderSwapPanel(session, data));
  } catch (e) {
    panel.innerHTML = '';
    panel.appendChild(el('div', { class: 'small', style: 'color:var(--red);padding:8px 12px' }, e.message));
  }
}

function renderSwapPanel(session, data) {
  const wrap = el('div', {
    style: 'margin:2px 0 12px 78px;padding:12px;background:var(--panel);border:1px solid var(--border);border-radius:8px',
  });
  wrap.appendChild(el('div', { class: 'small bold', style: 'margin-bottom:8px' },
    `Alternate sections for ${session.subject_code} ${session.activity_type}`));
  if (!data.clean.length && !data.blocked.length) {
    wrap.appendChild(el('div', { class: 'small muted' }, 'No alternate sections exist.'));
    return wrap;
  }
  for (const alt of data.clean) {
    wrap.appendChild(altRow(session, alt, false));
  }
  for (const alt of data.blocked) {
    wrap.appendChild(altRow(session, alt, true));
  }
  return wrap;
}

function altRow(fromSession, alt, blocked) {
  const label = `${alt.section_code ?? '—'} — ${DAY_NAMES[alt.day_of_week]} ${alt.start_time} · ${alt.location}`;
  const row = el('div', {
    style: 'display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px',
  }, [
    el('div', { style: 'flex:1' }, [
      el('span', {}, label),
      blocked ? el('span', {
        style: 'color:var(--red);margin-left:8px;font-size:11px',
      }, `clashes with session at ${alt.blocker.start_time}`) : null,
    ]),
    blocked
      ? el('span', { class: 'small muted' }, 'unavailable')
      : el('button', {
          class: 'btn sm pri',
          onclick: async () => {
            try {
              await api.post('/api/timetable/swap', {
                from_session_id: fromSession.id,
                to_session_id: alt.id,
              });
              toast(`Swapped to ${alt.section_code ?? 'alternate section'}`, 'success');
              setTimeout(() => location.reload(), 300);
            } catch (e) { toast(e.message, 'error'); }
          },
        }, 'Apply'),
  ]);
  return row;
}

function renderMiniCal(data) {
  const card = el('div', { class: 'card', style: 'margin-bottom:14px' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['This week', el('span', { class: 'br-tag' }, 'BR02-16')]),
    ]),
    el('div', { class: 'card-bd', style: 'padding:12px' }),
  ]);
  const body = card.querySelector('.card-bd');

  const clashIds = new Set();
  for (const c of data.clashes) { clashIds.add(c.a); clashIds.add(c.b); }

  const hourStart = 8, hourEnd = 19;
  const rows = hourEnd - hourStart;
  const days = ['Mon','Tue','Wed','Thu','Fri'];
  const cal = el('div', {
    class: 'cal',
    style: `font-size:9px;grid-template-rows:22px repeat(${rows},28px)`,
  });
  cal.appendChild(el('div', { class: 'cal-cnr' }));
  for (const d of days) cal.appendChild(el('div', { class: 'cal-day-h', style: 'font-size:11px;padding:4px 0' }, d));
  for (let h = hourStart; h < hourEnd; h++) {
    const row = (h - hourStart) + 2;
    const timeCell = el('div', { class: 'cal-t', style: `grid-row:${row};font-size:8.5px` }, String(h).padStart(2, '0'));
    cal.appendChild(timeCell);
    for (let i = 0; i < 5; i++) cal.appendChild(el('div', { style: `grid-row:${row};grid-column:${i+2}` }));
  }
  for (const s of data.sessions) {
    const d = s.day_of_week - 1; // 1=Mon → 0
    if (d < 0 || d > 4) continue;
    const startMin = toMin(s.start_time);
    const startHourIdx = Math.floor(startMin / 60) - hourStart;
    const endMin = startMin + s.duration_min;
    const endHourIdx = Math.ceil(endMin / 60) - hourStart;
    const sr = startHourIdx + 2, er = endHourIdx + 2;
    const t = s.activity_type.toLowerCase();
    const clashCls = clashIds.has(s.id) ? ' clash' : '';
    cal.appendChild(el('div', {
      class: `ev ${t}${clashCls}`,
      style: `grid-row:${sr}/${er};grid-column:${d+2};padding:2px 4px`,
    }, [
      el('span', { class: 'ec', style: 'font-size:8.5px' }, s.subject_code),
    ]));
  }
  body.appendChild(cal);
  return card;
}

function renderNotifs() {
  const card = el('div', { class: 'card', style: 'margin-bottom:14px' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['Notifications', el('span', { class: 'br-tag' }, 'BR02-04')]),
      el('span', { class: 'rt' }, '3 new'),
    ]),
    el('div', { class: 'card-bd' }, [
      el('div', { class: 'notif-item warn' }, [
        el('div', { class: 'tt' }, 'Room change — CSE3001 Tutorial'),
        el('div', {}, "Thursday's tutorial moved from Lab 3.02 to Lab 2.05."),
        el('div', { class: 'mt' }, '2 hours ago'),
      ]),
      el('div', { class: 'notif-item due' }, [
        el('div', { class: 'tt' }, 'Assignment due Friday'),
        el('div', {}, 'CSE3001 Assignment 1 — submit via LMS by 23:59 Fri.'),
        el('div', { class: 'mt' }, 'yesterday'),
      ]),
      el('div', { class: 'notif-item info' }, [
        el('div', { class: 'tt' }, 'Guest lecture added'),
        el('div', {}, 'SWE3003 — industry guest session, optional, Wed 14:00 Lab 2.05.'),
        el('div', { class: 'mt' }, '2 days ago'),
      ]),
    ]),
  ]);
  return card;
}

function renderSubscribe() {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [el('h3', {}, 'Subscribe')]),
    el('div', { class: 'card-bd', style: 'font-size:12px;color:var(--ink-2);line-height:1.55' }, [
      'Subscribe to a live feed so your timetable stays up to date in Outlook, Google Calendar, or Apple Calendar.',
      el('div', { style: 'margin-top:12px;display:flex;gap:6px;flex-wrap:wrap' }, [
        el('button', { class: 'btn', onclick: async () => {
          const url = new URL('/api/calendar.ics', location.href).toString();
          try {
            await navigator.clipboard.writeText(url);
            toast('Feed URL copied to clipboard', 'success');
          } catch { toast(url, 'success'); }
        } }, 'Copy feed URL'),
        el('button', { class: 'btn ghost', onclick: () => alert('Would email instructions') }, 'Email me instructions'),
      ]),
    ]),
  ]);
}

function findClashPartner(session, data) {
  for (const c of data.clashes) {
    if (c.a === session.id) return data.sessions.find(x => x.id === c.b);
    if (c.b === session.id) return data.sessions.find(x => x.id === c.a);
  }
  return null;
}
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function endTime(start, durMin) {
  const [h, m] = start.split(':').map(Number);
  const end = h * 60 + m + durMin;
  return `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;
}
function isCurrentSlot(s) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = toMin(s.start_time);
  return now.getDay() === s.day_of_week && nowMin >= start && nowMin < start + s.duration_min;
}
function weekDatesArr() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out[(i + 1) % 7] = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
  // Re-index so that out[dayOfWeek] = date string
  const result = {};
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    const d = new Date(monday);
    const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setDate(monday.getDate() + offset);
    result[dayOfWeek] = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
  return result;
}
