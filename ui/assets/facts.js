import { api, el, initShell, toast } from './app.js';
import { mountAgentDock } from './agent-dock.js';

initShell({ active: 'facts', crumb: 'What I know' });
mountAgentDock({ context: 'facts', refresh: load });

const page = document.getElementById('page');
const CATEGORIES = ['preference', 'context', 'goal', 'schedule', 'topic', 'other'];

async function load() {
  const facts = await api.get('/api/facts');
  render(facts);
}

function render(facts) {
  page.innerHTML = '';
  const extracted = facts.filter(f => f.source === 'extracted');
  const remembered = facts.filter(f => f.source === 'remember');

  page.appendChild(el('div', { class: 'page-head' }, [
    el('h1', { class: 'page-title', html: 'What I know <span class="it">about you</span>' }),
    el('div', { class: 'page-sub' },
      'Facts are either something you told me to remember or something I inferred from conversation. You own this memory — edit, delete, or promote anything. Nothing here is shared with anyone else.'),
    el('div', { class: 'page-meta' }, [
      metaItem('Confirmed', remembered.length),
      metaItem('Extracted', extracted.length),
      metaItem('Total', facts.length),
    ]),
  ]));

  page.appendChild(renderAddForm());

  if (extracted.length) {
    page.appendChild(sectionCard('Extracted from conversation',
      'Automatically inferred — promote to confirmed if accurate, or delete if not.',
      extracted));
  }
  page.appendChild(sectionCard('Confirmed', 'Things you explicitly asked me to remember.', remembered));

  if (!facts.length) {
    page.appendChild(el('div', { class: 'card', style: 'margin-top:14px' }, [
      el('div', { class: 'card-bd', style: 'padding:32px;text-align:center;color:var(--muted)' },
        'No facts yet. Use `/remember <fact>` in the agent dock to add one.'),
    ]));
  }
}

function metaItem(label, value) {
  return el('div', {}, [
    el('span', { class: 'k' }, label),
    el('span', { class: 'v' }, String(value)),
  ]);
}

function sectionCard(title, subtitle, rows) {
  const card = el('div', { class: 'card', style: 'margin-top:14px' });
  card.appendChild(el('div', { class: 'card-hd' }, [
    el('div', {}, [
      el('h3', {}, title),
      el('div', { class: 'small muted', style: 'margin-top:2px' }, subtitle),
    ]),
    el('span', { class: 'rt' }, `${rows.length}`),
  ]));
  const body = el('div', { class: 'card-bd', style: 'padding:0' });
  if (!rows.length) {
    body.appendChild(el('div', { class: 'muted small', style: 'padding:14px 18px' }, 'Nothing here yet.'));
  } else {
    const list = el('div', { class: 'facts-list' });
    for (const f of rows) list.appendChild(renderFact(f));
    body.appendChild(list);
  }
  card.appendChild(body);
  return card;
}

function renderFact(f) {
  return el('div', { class: 'fact-row' }, [
    el('div', {}, [
      el('div', { class: 'fact-body' }, f.body),
      el('div', { class: 'fact-meta' }, [
        el('span', { class: `chip ${f.category}` }, f.category),
        el('span', { class: 'mono', style: 'color:var(--muted)' }, `id:${f.id}`),
        f.source === 'extracted' ? el('span', { class: 'fact-confidence' }, `${Math.round((f.confidence ?? 0) * 100)}% confidence`) : null,
      ]),
    ]),
    el('div', { class: 'fact-actions' }, [
      f.source === 'extracted' ? el('button', {
        class: 'btn sm ghost', type: 'button', title: 'Mark as confirmed',
        onclick: async () => {
          try { await api.patch(`/api/facts/${f.id}`, { source: 'remember' }); await load(); toast('Promoted to confirmed', 'success'); }
          catch (e) { toast(e.message, 'error'); }
        },
      }, 'Confirm') : null,
      el('button', {
        class: 'btn sm ghost', type: 'button', title: 'Edit',
        onclick: async () => {
          const body = prompt('Edit fact:', f.body);
          if (!body || body === f.body) return;
          try { await api.patch(`/api/facts/${f.id}`, { body }); await load(); toast('Updated', 'success'); }
          catch (e) { toast(e.message, 'error'); }
        },
      }, 'Edit'),
      el('button', {
        class: 'btn sm btn-danger-ghost', type: 'button', title: 'Delete',
        onclick: async () => {
          if (!confirm(`Delete this fact?\n\n"${f.body}"`)) return;
          try { await api.del(`/api/facts/${f.id}`); await load(); toast('Removed', 'success'); }
          catch (e) { toast(e.message, 'error'); }
        },
      }, 'Delete'),
    ]),
  ]);
}

function renderAddForm() {
  const card = el('div', { class: 'card' });
  card.appendChild(el('div', { class: 'card-hd' }, [
    el('h3', {}, 'Add a fact'),
    el('span', { class: 'rt' }, 'confirmed'),
  ]));
  const body = el('div', { class: 'card-bd' });
  const grid = el('div', { style: 'display:grid;grid-template-columns:2fr 1fr auto;gap:12px;align-items:end' });
  const input = el('input', { class: 'input', placeholder: 'e.g. I prefer concise answers' });
  const cat = el('select', { class: 'select' });
  for (const c of CATEGORIES) cat.appendChild(el('option', { value: c }, c[0].toUpperCase() + c.slice(1)));
  cat.value = 'preference';
  const submit = el('button', {
    class: 'btn pri',
    onclick: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { toast('Fact body required', 'error'); return; }
      try {
        await api.post('/api/facts', { body: input.value.trim(), category: cat.value });
        input.value = '';
        await load();
        toast('Added', 'success');
      } catch (e) { toast(e.message, 'error'); }
    },
  }, 'Remember');
  grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Fact'), input]));
  grid.appendChild(el('div', {}, [el('label', { class: 'label' }, 'Category'), cat]));
  grid.appendChild(submit);
  body.appendChild(grid);
  card.appendChild(body);
  return card;
}

await load();
