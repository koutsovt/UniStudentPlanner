import { api, el, initShell, toast, humanPeriod } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'planner', crumb: 'Plan my degree' });
const page = document.getElementById('page');

let state = { periods: [], plan: [], available: [], issues: [] };
let searchQuery = '';

async function load() {
  const [p, v] = await Promise.all([
    api.get('/api/planner'),
    api.get('/api/planner/validate'),
  ]);
  state = { ...p, issues: v.issues };
  render();
}

function render() {
  page.innerHTML = '';
  const credits = creditSummary();

  page.appendChild(el('div', { class: 'page-head' }, [
    el('h1', { class: 'page-title', html: 'Plan your <span class="it">degree</span>' }),
    el('div', { class: 'page-sub' },
      'Map your path to graduation across every semester. Drag subjects between terms, validate against prerequisites and credit caps, and request advisor review when ready.'),
    el('div', { class: 'page-meta' }, [
      metaItem('Pathway',       'Standard full-time'),
      metaItem('Credit points', `${credits.total}/${credits.max}`,  'BR04-09'),
      metaItem('Subjects',      `${state.plan.length} planned`),
      metaItem('Plan status',
        planStatusLabel(),
        null,
        planStatusTone()),
    ]),
  ]));

  const alerts = el('div', { class: 'alerts' });
  renderAlerts(alerts);
  page.appendChild(alerts);

  const grid = el('div', { class: 'plan-grid' }, [
    renderLeftRail(),
    renderCenter(),
    renderRightRail(credits),
  ]);
  page.appendChild(grid);
}

function planStatusLabel() {
  const errors = state.issues.filter(i => i.severity === 'error').length;
  const clashes = state.issues.filter(i => i.kind === 'clash').length;
  if (errors) return `${errors} issue${errors === 1 ? '' : 's'}`;
  if (clashes) return 'Review timetable';
  return 'On track';
}
function planStatusTone() {
  if (state.issues.some(i => i.severity === 'error')) return 'warn';
  if (state.issues.some(i => i.kind === 'clash')) return 'warn';
  return 'ok';
}

function creditSummary() {
  const totals = { completed: 0, enrolled: 0, planned: 0 };
  for (const p of state.plan) totals[p.status] = (totals[p.status] ?? 0) + p.credit_points;
  return { ...totals, total: totals.completed + totals.enrolled + totals.planned, max: 360 };
}

function metaItem(label, value, br, cls) {
  return el('div', {}, [
    el('span', { class: 'k' }, label),
    el('span', { class: `v${cls ? ' ' + cls : ''}`, html: value + (br ? ` <span class="br-tag">${br}</span>` : '') }),
  ]);
}

function renderAlerts(host) {
  const errors   = state.issues.filter(i => i.severity === 'error');
  const clashes  = state.issues.filter(i => i.kind === 'clash');
  const warnings = state.issues.filter(i => i.severity === 'warning' && i.kind !== 'clash');
  if (!errors.length && !warnings.length && !clashes.length) {
    host.appendChild(el('div', { class: 'alert ok' }, [
      el('div', { class: 'ai' }, '✓'),
      el('div', { html: '<b>Plan validated.</b> All prerequisites, credit caps, and timetable pass against current SISOne/CourseLoop rules. <span class="br-tag">BR03-01 · BR04-07</span>' }),
    ]));
    return;
  }
  if (errors.length) {
    host.appendChild(el('div', { class: 'alert warn' }, [
      el('div', { class: 'ai' }, '!'),
      el('div', { html: `<b>${errors.length} prerequisite violation${errors.length > 1 ? 's' : ''}.</b> Move affected subjects to later terms. ` +
        errors.map(e => `<code style="font-family:var(--mono);font-size:11px;background:rgba(255,255,255,.5);padding:1px 5px;border-radius:2px">${e.subject_code}</code> ${e.message.toLowerCase()}`).join(' · ') +
        ' <span class="br-tag">BR03-01 · STOP</span>' }),
    ]));
  }
  if (clashes.length) {
    const body = el('div', {});
    body.appendChild(el('div', { html: `<b>${clashes.length} timetable clash${clashes.length > 1 ? 'es' : ''} this semester.</b> Sessions below overlap — adjust in Allocate+.` }));
    const list = el('ul', { style: 'margin:6px 0 0;padding-left:18px;font-size:12.5px' });
    for (const c of clashes) list.appendChild(el('li', {}, c.message));
    body.appendChild(list);
    body.appendChild(el('div', { class: 'small mt-2' }, [
      el('a', {
        href: '/timetable.html', class: 'inline-link',
      }, 'Open timetable →'),
      el('span', { class: 'subtle', style: 'margin:0 8px' }, '·'),
      el('a', {
        href: '#', class: 'inline-link',
        onclick: (e) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('agent:prefill', { detail: { text: '/clashes' } }));
        },
      }, 'Ask the agent'),
    ]));
    host.appendChild(el('div', { class: 'alert warn' }, [
      el('div', { class: 'ai' }, '⏱'),
      body,
    ]));
  }
  if (warnings.length) {
    host.appendChild(el('div', { class: 'alert info' }, [
      el('div', { class: 'ai' }, 'i'),
      el('div', { html: `<b>${warnings.length} warning${warnings.length > 1 ? 's' : ''}.</b> ` +
        warnings.map(w => w.message).join(' · ') +
        ' <span class="br-tag">BR03-03</span>' }),
    ]));
  }
}

function renderLeftRail() {
  const rail = el('aside', {});

  // Pathways card
  const pathwaysCard = el('div', { class: 'card', style: 'margin-bottom:14px' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['Recommended pathways', el('span', { class: 'br-tag' }, 'BR02-10')]),
    ]),
    el('div', { class: 'card-bd' }, [
      pathwayRow('Standard full-time', '3 years · 4 subjects/term · 120cp/yr', 'Flexible', true),
      pathwayRow('AI & ML specialisation', '3 years · locked core sequence', 'Partially locked', false),
      pathwayRow('Part-time', '5 years · 2 subjects/term', 'Flexible', false),
      el('div', { style: 'font-size:10.5px;color:var(--muted);padding:8px 2px 0;line-height:1.5' }, [
        'Sequencing ',
        el('span', { class: 'br-tag' }, 'BR02-08'),
        ' · ',
        el('b', {}, 'Flexible'), ' — move freely. ',
        el('b', {}, 'Partially locked'), ' — core semester-bound. ',
        el('b', {}, 'Fully locked'), ' — fixed sequence.',
      ]),
    ]),
  ]);
  rail.appendChild(pathwaysCard);

  // Catalog card
  const catalogCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['Subject catalog', el('span', { class: 'br-tag' }, 'BR04-06')]),
      el('span', { class: 'rt' }, `${state.available.length} available`),
    ]),
    el('div', { class: 'card-bd' }),
  ]);
  const body = catalogCard.querySelector('.card-bd');

  const search = el('input', {
    class: 'cat-search', placeholder: 'Search subjects…',
    value: searchQuery,
    oninput: (e) => { searchQuery = e.target.value.toLowerCase(); updateCatalogList(); },
  });
  body.appendChild(search);
  const list = el('div', { class: 'cat-list', id: 'cat-list' });
  body.appendChild(list);
  updateCatalogList();
  requestAnimationFrame(() => document.getElementById('cat-list') && updateCatalogList());

  rail.appendChild(catalogCard);
  return rail;
}

function updateCatalogList() {
  const list = document.getElementById('cat-list');
  if (!list) return;
  list.innerHTML = '';
  const filtered = state.available.filter(s =>
    !searchQuery ||
    s.code.toLowerCase().includes(searchQuery) ||
    s.title.toLowerCase().includes(searchQuery));
  let lastGroup = null;
  for (const s of filtered) {
    const type = s.component_type ?? 'elective';
    if (type !== lastGroup) {
      list.appendChild(el('div', { class: 'cat-group-lbl' },
        `${type.toUpperCase()} · ${s.component_title ?? 'Elective'}`));
      lastGroup = type;
    }
    const node = el('div', {
      class: 'cat-item', draggable: 'true', dataset: { code: s.code },
      onclick: () => openSubjectModal(s.code),
    }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'c' }, s.code),
        el('span', { class: 'cp' }, `${s.credit_points}cp`),
      ]),
      el('div', { class: 'n' }, s.title),
      el('div', { class: 'tg' }, [
        el('span', { class: `chip ${type}` }, type),
        el('span', { class: 'chip avail' }, 'S1 · S2'),
      ]),
    ]);
    attachDragSource(node, s.code);
    list.appendChild(node);
  }
  if (!filtered.length) {
    list.appendChild(el('div', { class: 'muted small', style: 'padding:12px 2px;text-align:center' },
      searchQuery ? 'No matches.' : 'All subjects planned.'));
  }
}

function pathwayRow(title, meta, lockLabel, selected) {
  const row = el('div', {
    style: 'padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);' +
           'background:var(--surface-2);margin-bottom:8px;display:flex;gap:12px;align-items:flex-start;' +
           'justify-content:space-between;font-size:12.5px;' +
           (selected ? 'border-color:var(--ink);background:var(--surface);box-shadow:inset 2px 0 0 var(--brand);' : ''),
  }, [
    el('div', {}, [
      el('div', { style: 'font-weight:600;color:var(--ink);line-height:1.3' }, title),
      el('div', { style: 'font-size:11px;color:var(--ink-3);margin-top:2px' }, meta),
      el('span', {
        style: `font-size:9px;padding:1px 5px;border-radius:2px;
          background:${lockLabel === 'Flexible' ? 'var(--surface-sunk)' : 'var(--amber-soft)'};
          color:${lockLabel === 'Flexible' ? 'var(--ink-3)' : 'var(--amber)'};
          font-weight:600;letter-spacing:.06em;text-transform:uppercase;
          display:inline-block;margin-top:4px`,
      }, lockLabel),
    ]),
    el('div', {
      style: 'width:12px;height:12px;border-radius:50%;border:1.5px solid var(--border-2);flex-shrink:0;margin-top:2px;' +
             (selected ? 'border-color:var(--brand);background:var(--brand);box-shadow:inset 0 0 0 2px #fff;' : ''),
    }),
  ]);
  return row;
}

function renderCenter() {
  const section = el('section', {});

  section.appendChild(el('div', {
    style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap',
  }, [
    el('div', { style: 'font-size:12.5px;color:var(--ink-3)' },
      'Drag subjects between terms, or click for details. Max 4 subjects per term (60cp).'),
    el('div', { style: 'display:flex;gap:6px' }, [
      el('button', { class: 'btn ghost', onclick: load }, 'Re-validate'),
      el('button', { class: 'btn pri', onclick: () => toast('Plan sent to advisor for review (BR01-38c)', 'success') },
        'Request advisor review'),
    ]),
  ]));

  // Group teaching periods by year
  const byYear = Object.create(null);
  for (const p of state.periods) (byYear[p.year] ??= []).push(p);
  const years = Object.keys(byYear).map(Number).sort();

  const planByPeriod = Object.create(null);
  for (const e of state.plan) (planByPeriod[e.teaching_period] ??= []).push(e);
  const issuesBySubject = Object.create(null);
  for (const i of state.issues) if (i.subject_code) (issuesBySubject[i.subject_code] ??= []).push(i);

  const yearsWrap = el('div', { class: 'years' });
  for (const year of years) {
    const periods = byYear[year].sort((a, b) => a.sort_order - b.sort_order);
    const ySubs = periods.flatMap(p => planByPeriod[p.code] ?? []);
    const cpTot = ySubs.reduce((s, x) => s + x.credit_points, 0);
    const pct = Math.min(100, cpTot / 120 * 100);
    const barCls = cpTot > 120 ? 'over' : (cpTot < 60 && year < new Date().getFullYear() ? 'warn' : '');
    const allComplete = ySubs.length && ySubs.every(s => s.status === 'completed');
    const anyCurrent = ySubs.some(s => s.status === 'enrolled');

    const yearEl = el('div', { class: 'year' });
    yearEl.appendChild(el('div', { class: 'year-hd' }, [
      el('div', { class: 't' }, [
        `Year ${year - (years[0] - 1)}`,
        el('span', { class: 'sub' },
          allComplete ? 'Completed' : anyCurrent ? 'In progress' : year < new Date().getFullYear() ? 'Past' : 'Planned'),
      ]),
      el('div', { class: 'load' }, [
        el('span', { class: 'load-mono' }, `${cpTot}cp`),
        el('div', { class: `load-bar ${barCls}` }, [el('div', { class: 'fill', style: `width:${pct}%` })]),
        el('span', { style: 'color:var(--muted);font-size:10.5px' }, 'of 120'),
      ]),
    ]));

    const yBody = el('div', { class: 'year-body' });
    for (const p of periods) {
      const subjects = (planByPeriod[p.code] ?? []).sort((a, b) => a.subject_code.localeCompare(b.subject_code));
      const cp = subjects.reduce((s, x) => s + x.credit_points, 0);
      const term = el('div', { class: 'term' }, [
        el('div', { class: 'term-hd' }, [
          el('span', { class: 'lbl' }, humanPeriod(p.code)),
          el('span', { class: 'cp' }, `${subjects.length}/4 · ${cp}cp`),
        ]),
      ]);
      const drop = el('div', { class: 'drop', dataset: { period: p.code } });
      for (const s of subjects) drop.appendChild(renderTile(s, issuesBySubject[s.subject_code] ?? []));
      if (p.status !== 'past') attachDropTarget(drop, p.code);
      term.appendChild(drop);
      yBody.appendChild(term);
    }
    yearEl.appendChild(yBody);
    yearsWrap.appendChild(yearEl);
  }
  section.appendChild(yearsWrap);
  return section;
}

function renderTile(entry, issues) {
  const status = entry.status;
  const locked = status === 'completed' || status === 'enrolled';
  const hasIssue = issues.some(i => i.severity === 'error');
  const seq = entry.component_type === 'core' ? 'lock' : 'flex';

  const tile = el('div', {
    class: `tile ${status}${hasIssue ? ' violate' : ''}`,
    draggable: locked ? 'false' : 'true',
    dataset: { code: entry.subject_code },
    onclick: (e) => { if (!e.target.closest('.rm')) openSubjectModal(entry.subject_code); },
  });

  if (!locked) {
    tile.appendChild(el('button', {
      class: 'rm', title: 'Remove',
      onclick: async (e) => {
        e.stopPropagation();
        try { await api.del(`/api/planner/entry/${entry.subject_code}`); await load(); toast('Removed', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      },
    }, '×'));
  }

  tile.appendChild(el('div', { class: 'r1' }, [
    el('span', { class: 'c' }, entry.subject_code),
    el('span', { class: `seq ${seq}` }, seq === 'lock' ? 'Locked' : 'Flex'),
    el('span', { class: 'dot' }),
  ]));
  tile.appendChild(el('div', { class: 'n' }, entry.title));
  tile.appendChild(el('div', { class: 'meta' }, [
    status === 'completed' && entry.grade
      ? el('span', {}, `${entry.credit_points}cp · ${entry.component_type}`)
      : el('span', {}, `${entry.credit_points}cp · ${entry.component_type ?? 'elective'}`),
    el('a', { href: '#', onclick: e => { e.preventDefault(); e.stopPropagation(); toast('Would open handbook'); } }, 'Handbook ↗'),
    status === 'completed' && entry.grade ? el('span', { class: 'grade' }, entry.grade) : null,
  ]));
  for (const issue of issues) {
    tile.appendChild(el('div', { class: 'vmsg', html: `<b>${issue.severity === 'error' ? 'Prereq gap:' : 'Note:'}</b> ${issue.message}` }));
  }
  if (!locked) attachDragSource(tile, entry.subject_code);
  else tile.title = `Cannot move a ${status} subject`;
  return tile;
}

function renderRightRail(credits) {
  const rail = el('aside', {});

  // Audit card
  const components = Object.create(null);
  for (const e of state.plan) {
    const t = e.component_type ?? 'elective';
    if (!components[t]) components[t] = { done: 0, plan: 0, total: 0 };
    if (e.status === 'completed') components[t].done += e.credit_points;
    else components[t].plan += e.credit_points;
  }
  // Component maxes — derived from state.plan; fall back to reasonable defaults
  const maxes = { core: 180, major: 90, minor: 45, elective: 45 };

  const auditCard = el('div', { class: 'card', style: 'margin-bottom:14px' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, ['Degree audit', el('span', { class: 'br-tag' }, 'BR04-02')]),
      el('span', { class: 'rt' }, `${Math.round(credits.total / credits.max * 100)}%`),
    ]),
    el('div', { class: 'card-bd' }, [
      auditRow('Core',     components.core     ?? { done: 0, plan: 0 }, maxes.core),
      auditRow('Major',    components.major    ?? { done: 0, plan: 0 }, maxes.major),
      auditRow('Minor',    components.minor    ?? { done: 0, plan: 0 }, maxes.minor),
      auditRow('Electives', components.elective ?? { done: 0, plan: 0 }, maxes.elective),
      auditRow('Credit points', { done: credits.completed, plan: credits.enrolled + credits.planned }, credits.max, true),
      el('div', { class: 'stat-grid' }, [
        el('div', { class: 'stat-cell' }, [
          el('div', { class: 'k' }, 'Credit done'),
          el('div', { class: 'v', html: `${credits.completed}<span class="u">cp</span>` }),
        ]),
        el('div', { class: 'stat-cell' }, [
          el('div', { class: 'k' }, 'Subjects'),
          el('div', { class: 'v', html: `${state.plan.filter(x => x.status === 'completed').length}<span class="u">/${Math.round(credits.max / 15)}</span>` }),
        ]),
      ]),
    ]),
  ]);
  rail.appendChild(auditCard);

  // Plan approval card
  const approvalCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-hd' }, [el('h3', {}, 'Plan approval')]),
    el('div', { class: 'card-bd', style: 'font-size:12.5px;color:var(--ink-2);line-height:1.55' }, [
      el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:8px' }, [
        el('span', { style: 'width:8px;height:8px;background:var(--amber);border-radius:50%' }),
        el('span', { style: 'font-weight:600' }, 'Awaiting review'),
      ]),
      el('div', { html: 'Sent to <b>Dr Emma Hart</b> · Senior Advisor' }),
      el('div', { style: 'color:var(--muted);font-family:var(--mono);font-size:11px' }, '2 days ago'),
      el('div', { style: 'margin-top:10px;font-size:11.5px;color:var(--ink-3)' },
        'Advisors can leave comments, approve the plan, or suggest changes before locking.'),
    ]),
  ]);
  rail.appendChild(approvalCard);
  return rail;
}

function auditRow(label, { done, plan }, total, emphasised = false) {
  const donePct = Math.min(100, (done / total) * 100);
  const planPct = Math.min(100 - donePct, (plan / total) * 100);
  return el('div', { class: 'audit-row' }, [
    el('div', { class: 'audit-top' }, [
      el('span', { class: 'l', style: emphasised ? 'font-weight:600' : '' }, label),
      el('span', { class: 'n' }, `${done + plan} / ${total}`),
    ]),
    el('div', { class: 'bar' }, [
      el('div', { class: 's done', style: `width:${donePct}%` }),
      el('div', { class: 's plan', style: `width:${planPct}%` }),
    ]),
  ]);
}

function attachDragSource(node, code) {
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/subject-code', code);
    node.classList.add('drag');
  });
  node.addEventListener('dragend', () => node.classList.remove('drag'));
}
function attachDropTarget(col, periodCode) {
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', () => col.classList.remove('over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('over');
    const code = e.dataTransfer.getData('text/subject-code');
    if (!code) return;
    try {
      await api.post('/api/planner/entry', { subject_code: code, teaching_period: periodCode });
      await load();
      toast('Plan updated', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ----- Modal -----
async function openSubjectModal(code) {
  const all = [...state.plan, ...state.available];
  const s = all.find(x => (x.subject_code ?? x.code) === code);
  if (!s) return;
  const type = s.component_type ?? 'elective';
  const seq = type === 'core' ? 'lock' : 'flex';
  const entry = state.plan.find(x => x.subject_code === code);
  const modalBg = document.getElementById('mdl-bg');
  const content = document.getElementById('mdl-content');
  if (!modalBg || !content) return;
  content.innerHTML = '';
  content.append(
    el('div', { class: 'eb' }, code),
    el('h2', {}, s.title ?? ''),
    el('dl', {}, [
      el('dt', {}, 'Credit points'), el('dd', {}, `${s.credit_points} credit points`),
      el('dt', {}, 'Type'), el('dd', {}, type[0].toUpperCase() + type.slice(1)),
      el('dt', { html: 'Sequencing <span class="br-tag">BR02-08</span>' }),
        el('dd', { html: seq === 'lock' ? '<code>Locked</code> · must follow prescribed sequence' : '<code>Flexible</code> · can move between terms' }),
      el('dt', { html: 'Prerequisites <span class="br-tag">BR04-07</span>' }),
        el('dd', { html: 'See handbook' }),
      el('dt', {}, 'Availability'),
        el('dd', {}, 'Semester 1 · Semester 2'),
      el('dt', {}, 'Status'),
        el('dd', { html: entry ? `<code>${entry.status}</code>${entry.grade ? ' · <b style="color:var(--green)">' + entry.grade + '</b>' : ''}` : '<span class="muted">Not yet planned</span>' }),
      el('dt', { html: 'Handbook <span class="br-tag">BR02-11</span>' }),
        el('dd', { html: '<a href="#" style="color:var(--brand-deep)">Open subject handbook →</a>' }),
    ]),
    el('div', { class: 'mdl-act' }, [
      el('button', { class: 'btn', onclick: () => modalBg.classList.remove('on') }, 'Close'),
    ]),
  );
  modalBg.classList.add('on');
}

await load();
mountAgentDock({ context: 'planner', refresh: load });
