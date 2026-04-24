import { api, el, initShell, humanPeriod, toast } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'progress', crumb: 'Track progress' });
const page = document.getElementById('page');

const [d, prog, assessments, planner] = await Promise.all([
  api.get('/api/dashboard'),
  api.get('/api/progress'),
  api.get('/api/assessments'),
  api.get('/api/planner'),
]);

page.appendChild(el('div', { class: 'page-head' }, [
  el('h1', { class: 'page-title', html: 'Track your <span class="it">progress</span>' }),
  el('div', { class: 'page-sub' },
    'Real-time degree audit mapped against every requirement. Updates automatically as SISOne posts completed results via the SAP PI/PO integration.'),
]));

// 4 stat cards
const credits = d.credits;
const weeksToGrad = () => {
  const remaining = credits.total - credits.completed - credits.enrolled - credits.planned;
  const est = Math.max(0, Math.ceil(remaining / 60));
  return est;
};
const gpaTrend = prog.grades.length >= 2 ? (prog.grades[prog.grades.length - 1].gpa - prog.grades[prog.grades.length - 2].gpa) : null;

page.appendChild(el('div', { class: 'prog-top' }, [
  progStat('Credit points', `${credits.completed}`, ` / ${credits.total}`,
    `${Math.round(credits.completed / credits.total * 100)}% complete · on track`,
    '↑', 'ok'),
  progStat('GPA', d.gpa != null ? d.gpa.toFixed(2) : '—', ' / 4.0',
    gpaTrend != null && gpaTrend > 0 ? `+${gpaTrend.toFixed(2)} since last sem` :
    gpaTrend != null && gpaTrend < 0 ? `${gpaTrend.toFixed(2)} since last sem` : 'Distinction avg',
    gpaTrend >= 0 ? '↑' : '↓', gpaTrend >= 0 ? 'ok' : 'down', 'BR04-08'),
  progStat('Enrolled this term', `${credits.enrolled}`, ' cp',
    'Semester 1, 2026 · 4 subjects'),
  progStat('Time to graduation', `${weeksToGrad() || '≤'}`, ' sem',
    `Projected ${humanPeriod('SEM' + ((weeksToGrad() % 2) + 1) + '-' + (new Date().getFullYear() + Math.ceil(weeksToGrad() / 2)))}`),
]));

function progStat(label, value, unit, tr, arrow, cls, br) {
  return el('div', { class: 'prog-stat' }, [
    el('div', { class: 'k', html: label + (br ? ` <span class="br-tag">${br}</span>` : '') }),
    el('div', { class: 'v', html: `${value}<span class="u">${unit}</span>` }),
    el('div', { class: 'tr' }, [
      arrow ? el('span', { class: `ar${cls === 'down' ? ' down' : ''}` }, arrow) : null,
      ' ' + tr,
    ]),
  ]);
}

// Requirements audit
page.appendChild(el('div', { class: 'card', style: 'margin-bottom:20px' }, [
  el('div', { class: 'card-hd' }, [
    el('h3', {}, [
      'Requirements audit — ' + d.course.title,
      el('span', { class: 'br-tag' }, 'BR04-02 · BR04-03 · BR04-04 · BR04-05'),
    ]),
  ]),
  el('div', { class: 'card-bd' }, [
    el('div', { class: 'req-table' }, prog.components.map(c => {
      const donePct = (c.completed_cp / c.credit_points) * 100;
      const planPct = Math.min(100 - donePct, (c.in_progress_cp / c.credit_points) * 100);
      const total = c.completed_cp + c.in_progress_cp;
      const status = total >= c.credit_points ? (c.completed_cp >= c.credit_points ? 'ok' : 'part') : 'pend';
      const statusTxt = status === 'ok' ? 'Complete' : `${c.completed_cp}+${c.in_progress_cp} / ${c.credit_points} cp`;
      return el('div', { class: 'row' }, [
        el('div', { class: 'nm' }, [
          el('b', {}, c.title),
          el('small', {}, `${c.type[0].toUpperCase() + c.type.slice(1)} component · ${c.credit_points} credit points required`),
        ]),
        el('div', {}, [
          el('div', { class: 'bar' }, [
            el('div', { class: 's done', style: `width:${donePct}%` }),
            el('div', { class: 's plan', style: `width:${planPct}%` }),
          ]),
        ]),
        el('div', { class: `st ${status}` }, statusTxt),
      ]);
    })),
  ]),
]));

// Subject forecasts
page.appendChild(renderForecastCard(assessments, planner));

// GPA trend + Milestones
const dual = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:20px' });
const trendCard = el('div', { class: 'card' }, [
  el('div', { class: 'card-hd' }, [
    el('h3', {}, 'GPA trend'),
    el('span', { class: 'rt' }, '4.0 scale'),
  ]),
  el('div', { class: 'card-bd' }),
]);
const trendBody = trendCard.querySelector('.card-bd');
if (prog.grades.length) {
  const maxGpa = 4.0;
  const chartH = 140;
  const bars = el('div', { style: `display:flex;align-items:flex-end;gap:14px;height:${chartH}px;padding:12px 0 0;border-top:1px solid var(--border)` });
  for (const g of prog.grades) {
    const pct = (g.gpa ?? 0) / maxGpa;
    bars.appendChild(el('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0' }, [
      el('div', {
        style: `width:100%;max-width:56px;height:${Math.max(6, pct * (chartH - 40))}px;` +
               `background:linear-gradient(180deg,var(--brand),var(--brand-deep));` +
               `border-radius:2px 2px 0 0;position:relative;align-self:center`,
      }, [
        el('div', { style: 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:10.5px;font-weight:600;color:var(--ink-2)' },
          (g.gpa ?? 0).toFixed(2)),
      ]),
      el('div', { style: 'font-size:10px;color:var(--muted);text-align:center;letter-spacing:.05em;text-transform:uppercase;font-weight:500' },
        g.label.replace('Semester ', 'Sem ')),
    ]));
  }
  trendBody.appendChild(bars);
} else {
  trendBody.appendChild(el('div', { class: 'muted small' }, 'No grades recorded yet.'));
}
dual.appendChild(trendCard);

// Milestones
const msCard = el('div', { class: 'card' }, [
  el('div', { class: 'card-hd' }, [el('h3', {}, 'Milestones & progression')]),
  el('div', { class: 'card-bd' }, [
    el('div', { class: 'tline' }, [
      milestone('Mar 2024', 'Enrolment confirmed', 'BCS commenced, identity provisioned to Entra ID', 'done'),
      milestone('Nov 2024', 'Year 1 complete', '120cp, GPA 3.1 · No requisite violations', 'done'),
      milestone('Nov 2025', 'Year 2 complete', `120cp at end of Sem 2 · GPA ${d.gpa != null ? d.gpa.toFixed(1) : '—'}`, 'done'),
      milestone('Apr 2026', 'Year 3 Semester 1 in progress', '4 subjects, assignment due Fri', 'now'),
      milestone('Jul 2026', 'Sem 2 2026 enrolment opens', 'Elective choice deadline', ''),
      milestone('Nov 2026', 'Projected graduation', 'Pending Year 3 completion', ''),
    ]),
  ]),
]);
dual.appendChild(msCard);
page.appendChild(dual);

function milestone(dt, title, meta, cls) {
  return el('div', { class: `m ${cls}` }, [
    el('span', { class: 'dt' }, dt),
    el('b', {}, title),
    ' · ',
    meta,
  ]);
}

// ----- Forecast card -----
function renderForecastCard(assessmentsList, plannerData) {
  const enrolled = plannerData.plan
    .filter(p => p.status === 'enrolled')
    .sort((a, b) => a.subject_code.localeCompare(b.subject_code));
  const bySubject = Object.create(null);
  for (const a of assessmentsList) (bySubject[a.subject_code] ??= []).push(a);

  const card = el('div', { class: 'card', style: 'margin-bottom:20px' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, 'Subject forecasts'),
      el('span', { class: 'rt' }, `${enrolled.length} enrolled`),
    ]),
    el('div', { class: 'card-bd' }),
  ]);
  const body = card.querySelector('.card-bd');
  if (!enrolled.length) {
    body.appendChild(el('div', { class: 'muted small' }, 'No enrolled subjects.'));
    return card;
  }
  for (const e of enrolled) {
    body.appendChild(subjectForecastRow(e, bySubject[e.subject_code] ?? []));
  }
  return card;
}

function subjectForecastRow(planEntry, initialAssessments) {
  const row = el('div', { class: 'fc-row', style: 'border-top:1px solid var(--border);padding:14px 0' });
  const summary = el('div', { class: 'fc-summary', style: 'cursor:pointer' });
  const detail  = el('div', { class: 'fc-detail', style: 'display:none;margin-top:14px' });
  row.appendChild(summary);
  row.appendChild(detail);

  let assessments = initialAssessments.slice();
  let forecast = null;
  let expanded = false;
  let detailRendered = false;
  const simulated = new Map(); // assessment_id -> simulated score %

  const rerenderSummary = () => {
    summary.innerHTML = '';
    const committed = forecast?.committed_weight ?? 0;
    const remaining = forecast?.remaining_weight ?? 0;
    const total     = forecast?.total_weight ?? (committed + remaining);
    const earned    = forecast?.earned_pct ?? 0;
    const earnedPct = total > 0 ? (earned / total) * 100 : 0;
    const commPct   = total > 0 ? (committed / total) * 100 : 0;
    const scen = forecast?.scenarios;
    const letter = forecast?.letter_forecast ?? '—';
    summary.appendChild(el('div', { style: 'display:grid;grid-template-columns:1fr 180px auto;gap:16px;align-items:center' }, [
      el('div', {}, [
        el('b', {}, `${planEntry.subject_code}  `),
        el('span', { style: 'color:var(--ink-2)' }, planEntry.title ?? ''),
        el('div', { class: 'small', style: 'color:var(--muted);margin-top:4px' },
          scen
            ? `Expected ${scen.expected.toFixed(1)}% (${letter}) · best ${scen.best.toFixed(1)} · worst ${scen.worst.toFixed(1)}`
            : 'No assessments yet — add one to forecast.'),
        forecast?.weight_warning
          ? el('div', { class: 'small', style: 'color:var(--red);margin-top:2px' }, forecast.weight_warning)
          : null,
      ]),
      el('div', { class: 'bar', title: `${earned.toFixed(1)} pts earned of ${committed}% committed` }, [
        el('div', { class: 's done', style: `width:${earnedPct}%` }),
        el('div', { class: 's plan', style: `width:${Math.max(0, commPct - earnedPct)}%` }),
      ]),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
        el('span', { class: 'small', style: 'color:var(--muted);font-family:var(--mono)' },
          `${assessments.length} assessment${assessments.length === 1 ? '' : 's'}`),
        el('span', { class: 'small', style: 'color:var(--muted)' }, expanded ? '▴' : '▾'),
      ]),
    ]));
  };

  const refreshForecast = async () => {
    try {
      forecast = await api.get(`/api/assessments/forecast/${planEntry.subject_code}`);
    } catch { forecast = null; }
    rerenderSummary();
  };

  const rerenderDetail = () => {
    detail.innerHTML = '';
    if (assessments.length) {
      const table = el('div', { class: 'fc-table', style: 'display:grid;grid-template-columns:2fr 80px 130px 90px auto;gap:8px;align-items:center;font-size:12px' });
      table.appendChild(el('div', { class: 'small bold' }, 'Assessment'));
      table.appendChild(el('div', { class: 'small bold' }, 'Weight %'));
      table.appendChild(el('div', { class: 'small bold' }, 'Due'));
      table.appendChild(el('div', { class: 'small bold' }, 'Score %'));
      table.appendChild(el('div', {}));
      for (const a of assessments) {
        table.appendChild(assessmentRow(a));
      }
      detail.appendChild(table);
      const unmarked = assessments.filter(a => a.score_pct == null);
      if (unmarked.length) detail.appendChild(renderWhatIf(unmarked));
    } else {
      detail.appendChild(el('div', { class: 'muted small', style: 'margin-bottom:10px' },
        'No assessments yet.'));
    }
    detail.appendChild(renderAddForm());
  };

  function computeLocalForecast(list) {
    let earned = 0, committed = 0, remaining = 0;
    for (const a of list) {
      if (a.score_pct == null) remaining += a.weight_pct;
      else { committed += a.weight_pct; earned += a.weight_pct * a.score_pct / 100; }
    }
    const rate = committed > 0 ? earned / committed : 0.70;
    const expected = earned + remaining * rate;
    return {
      expected: Math.round(expected * 10) / 10,
      letter: expected >= 80 ? 'HD' : expected >= 70 ? 'D' : expected >= 60 ? 'C' : expected >= 50 ? 'P' : 'F',
    };
  }

  function renderWhatIf(unmarked) {
    const wrap = el('div', { style: 'margin-top:16px;padding:12px;background:var(--panel);border:1px solid var(--border);border-radius:8px' });
    wrap.appendChild(el('div', { class: 'small bold', style: 'margin-bottom:8px' }, 'What-if: simulate unmarked scores'));

    const readout = el('div', { class: 'small', style: 'margin-bottom:10px;font-family:var(--mono)' });
    const reset = el('button', { class: 'btn sm ghost' }, 'Reset');

    const recompute = () => {
      const sim = assessments.map(a => {
        if (a.score_pct != null) return a;
        const s = simulated.get(a.id);
        return s == null ? a : { ...a, score_pct: s };
      });
      const f = computeLocalForecast(sim);
      const any = [...simulated.values()].some(v => v != null);
      readout.innerHTML = '';
      readout.appendChild(el('span', {}, any
        ? `Simulated expected: `
        : `Move a slider to see a projected result.`));
      if (any) {
        readout.appendChild(el('b', { style: 'color:var(--brand-deep)' },
          `${f.expected.toFixed(1)}% (${f.letter})`));
      }
    };

    const grid = el('div', { style: 'display:grid;grid-template-columns:1.5fr 1fr 60px;gap:8px 12px;align-items:center' });
    for (const a of unmarked) {
      const slider = el('input', {
        type: 'range', min: '0', max: '100', step: '1',
        value: simulated.get(a.id) ?? '',
        style: 'width:100%',
      });
      const val = el('span', { class: 'small', style: 'font-family:var(--mono);text-align:right' },
        simulated.has(a.id) ? `${simulated.get(a.id)}%` : '—');
      slider.addEventListener('input', () => {
        simulated.set(a.id, Number(slider.value));
        val.textContent = `${slider.value}%`;
        recompute();
      });
      grid.appendChild(el('div', { class: 'small' }, [
        el('b', {}, a.title),
        ' ',
        el('span', { class: 'muted' }, `(${a.weight_pct}%)`),
      ]));
      grid.appendChild(slider);
      grid.appendChild(val);
    }
    wrap.appendChild(grid);
    wrap.appendChild(el('div', { style: 'margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:12px' }, [
      readout,
      reset,
    ]));
    reset.addEventListener('click', () => { simulated.clear(); rerenderDetail(); });
    recompute();
    return wrap;
  }

  function assessmentRow(a) {
    const titleIn  = el('input', { class: 'input', value: a.title });
    const weightIn = el('input', { class: 'input', type: 'number', min: '0', max: '100', step: '0.1', value: a.weight_pct });
    const dueIn    = el('input', { class: 'input', type: 'datetime-local', value: a.due_at ?? '' });
    const scoreIn  = el('input', { class: 'input', type: 'number', min: '0', max: '100', step: '0.1',
      value: a.score_pct == null ? '' : a.score_pct, placeholder: '—' });
    const save = async () => {
      try {
        const body = {
          title: titleIn.value,
          weight_pct: Number(weightIn.value),
          due_at: dueIn.value || null,
          score_pct: scoreIn.value === '' ? null : Number(scoreIn.value),
        };
        await api.patch(`/api/assessments/${a.id}`, body);
        Object.assign(a, body);
        await refreshForecast();
      } catch (e) { toast(e.message, 'error'); }
    };
    const del = async () => {
      try {
        await api.del(`/api/assessments/${a.id}`);
        assessments = assessments.filter(x => x.id !== a.id);
        rerenderDetail();
        await refreshForecast();
        toast('Removed', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    for (const inp of [titleIn, weightIn, dueIn, scoreIn]) inp.addEventListener('change', save);
    const frag = document.createDocumentFragment();
    frag.appendChild(titleIn);
    frag.appendChild(weightIn);
    frag.appendChild(dueIn);
    frag.appendChild(scoreIn);
    frag.appendChild(el('button', { class: 'btn sm ghost', onclick: del }, 'Delete'));
    return frag;
  }

  function renderAddForm() {
    const wrap = el('div', { style: 'margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)' });
    const titleIn  = el('input', { class: 'input', placeholder: 'e.g. Final Exam' });
    const weightIn = el('input', { class: 'input', type: 'number', min: '0', max: '100', step: '0.1', placeholder: '30' });
    const dueIn    = el('input', { class: 'input', type: 'datetime-local' });
    const scoreIn  = el('input', { class: 'input', type: 'number', min: '0', max: '100', step: '0.1', placeholder: 'leave blank if unmarked' });
    const add = async () => {
      if (!titleIn.value.trim() || weightIn.value === '') {
        toast('Title and weight required', 'error'); return;
      }
      try {
        const res = await api.post('/api/assessments', {
          subject_code: planEntry.subject_code,
          title: titleIn.value.trim(),
          weight_pct: Number(weightIn.value),
          due_at: dueIn.value || null,
          score_pct: scoreIn.value === '' ? null : Number(scoreIn.value),
        });
        assessments.push({
          id: res.id, student_id: null, subject_code: planEntry.subject_code,
          title: titleIn.value.trim(), weight_pct: Number(weightIn.value),
          due_at: dueIn.value || null,
          score_pct: scoreIn.value === '' ? null : Number(scoreIn.value),
          reminder_id: res.reminder_id,
        });
        rerenderDetail();
        await refreshForecast();
        toast('Assessment added' + (res.reminder_id ? ' (reminder created)' : ''), 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    const grid = el('div', { style: 'display:grid;grid-template-columns:2fr 80px 130px 90px auto;gap:8px;align-items:end' });
    grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'New assessment'), titleIn]));
    grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Weight %'), weightIn]));
    grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Due'), dueIn]));
    grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Score %'), scoreIn]));
    grid.appendChild(el('button', { class: 'btn pri sm', onclick: add }, 'Add'));
    wrap.appendChild(grid);
    return wrap;
  }

  summary.addEventListener('click', () => {
    expanded = !expanded;
    detail.style.display = expanded ? 'block' : 'none';
    if (expanded && !detailRendered) { rerenderDetail(); detailRendered = true; }
    rerenderSummary();
  });

  refreshForecast();
  rerenderSummary();
  return row;
}

mountAgentDock({ context: 'progress' });
