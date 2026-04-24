import { api, el, initShell, toast, formatDue } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'reminders', crumb: 'Reminders' });
const page = document.getElementById('page');

async function load() {
  const reminders = await api.get('/api/reminders');
  render(reminders);
}

function render(reminders) {
  page.innerHTML = '';
  const pending = reminders.filter(r => !r.done);
  const done = reminders.filter(r => r.done);

  page.appendChild(el('div', { class: 'page-head' }, [
    el('h1', { class: 'page-title', html: 'Your <span class="it">reminders</span>' }),
    el('div', { class: 'page-sub' },
      'Deadlines, study blocks, and advisor meetings. Mandatory reminders (account holds, exam changes) cannot be disabled.'),
    el('div', { class: 'page-meta' }, [
      metaItem('Open', pending.length),
      metaItem('Completed', done.length),
      metaItem('Next',
        pending[0] ? formatDue(pending[0].due_at) : '—'),
    ]),
  ]));

  page.appendChild(renderAddForm());

  page.appendChild(el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('div', { class: 'card-hd' }, [
      el('h3', {}, 'Upcoming'),
      el('span', { class: 'rt' }, `${pending.length} open`),
    ]),
    el('div', { class: 'card-bd' },
      pending.length ? el('div', { class: 'rem-list' }, pending.map(renderRow))
                     : el('div', { class: 'muted small' }, 'Nothing upcoming.')),
  ]));

  if (done.length) {
    page.appendChild(el('div', { class: 'card', style: 'margin-top:14px' }, [
      el('div', { class: 'card-hd' }, [
        el('h3', {}, 'Completed'),
        el('span', { class: 'rt' }, `${done.length} done`),
      ]),
      el('div', { class: 'card-bd' }, el('div', { class: 'rem-list' }, done.map(renderRow))),
    ]));
  }
}

function metaItem(label, value, br) {
  return el('div', {}, [
    el('span', { class: 'k' }, label),
    el('span', { class: 'v', html: value + (br ? ` <span class="br-tag">${br}</span>` : '') }),
  ]);
}

function renderRow(r) {
  const row = el('div', { class: 'rem-row' + (r.done ? ' done' : '') }, [
    el('div', {
      class: 'rem-check' + (r.done ? ' on' : ''),
      role: 'checkbox',
      onclick: async () => {
        try { await api.patch(`/api/reminders/${r.id}`, { done: !r.done }); await load(); }
        catch (e) { toast(e.message, 'error'); }
      },
    }),
    el('div', {}, [
      el('div', { class: 'rem-t' }, r.title),
      el('div', { class: 'rem-m' }, [
        el('span', { class: `kind-pill ${r.kind}` }, r.kind),
        el('span', { class: 'tm' }, formatDue(r.due_at)),
        r.subject_code ? el('span', { class: 'mono', style: 'color:var(--brand-deep);font-weight:500' }, r.subject_code) : null,
      ]),
    ]),
    el('button', {
      class: 'btn sm ghost',
      onclick: async () => {
        try { await api.del(`/api/reminders/${r.id}`); await load(); toast('Removed', 'success'); }
        catch (e) { toast(e.message, 'error'); }
      },
    }, 'Delete'),
  ]);
  return row;
}

function renderAddForm() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card-hd' }, [
    el('h3', {}, [
      'New reminder',
      el('span', { class: 'br-tag' }, 'BR05-02'),
    ]),
  ]));
  const body = el('div', { class: 'card-bd' });
  const grid = el('div', { style: 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:12px;align-items:end' });
  const titleInput = el('input', { class: 'input', placeholder: 'e.g. Review CSE3001 Week 6 problems' });
  const dateInput  = el('input', { class: 'input', type: 'datetime-local' });
  const kindSelect = el('select', { class: 'select' });
  for (const k of ['assessment', 'study', 'advisor', 'enrolment', 'other']) {
    kindSelect.appendChild(el('option', { value: k }, k[0].toUpperCase() + k.slice(1)));
  }
  kindSelect.value = 'study';
  const submitBtn = el('button', {
    class: 'btn pri',
    onclick: async (e) => {
      e.preventDefault();
      if (!titleInput.value || !dateInput.value) { toast('Title and date required', 'error'); return; }
      try {
        await api.post('/api/reminders', { title: titleInput.value, due_at: dateInput.value, kind: kindSelect.value });
        titleInput.value = ''; dateInput.value = '';
        await load();
        toast('Reminder added', 'success');
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'Add reminder');

  grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Title'), titleInput]));
  grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Due'),   dateInput]));
  grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Kind'),  kindSelect]));
  grid.appendChild(submitBtn);
  body.appendChild(grid);
  card.appendChild(body);
  return card;
}

await load();
mountAgentDock({ context: 'reminders', refresh: load });
