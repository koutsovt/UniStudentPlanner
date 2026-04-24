import { api, el, renderMarkdown, toast } from './app.js';

const CONTEXT_CONFIG = {
  dashboard: { label: 'Overview',  hints: ['/schedule', '/deadlines', '/progress', '/help'] },
  planner:   { label: 'Plan',      hints: ['/validate', '/prereq ', '/alternatives ', '/gap'] },
  timetable: { label: 'Timetable', hints: ['/next', '/clashes', '/resolve ', '/freeslots'] },
  progress:  { label: 'Progress',  hints: ['/gpa', '/gap', '/milestones', '/requirements'] },
  reminders: { label: 'Reminders', hints: ['/deadlines', '/remind ', '/upcoming'] },
  facts:     { label: 'Facts',     hints: ['/facts', '/remember ', '/forget '] },
  settings:  { label: 'Settings',  hints: ['/help', '/facts', '/progress'] },
  agent:     { label: 'Agent',     hints: ['/help', '/schedule', '/progress', '/plan', '/deadlines'] },
};

const MUTATING_COMMANDS = /^\/(remind|remember|forget)\b/i;

let mounted = false;
let panelEl, messagesEl, inputEl, fabEl, formEl, sendBtn, threadChipEl, threadMenuEl;
let currentContext = 'agent';
let refreshCallback = null;
let threads = [];
let currentThreadId = null;

export function mountAgentDock({ context = 'agent', refresh = null } = {}) {
  currentContext = context;
  refreshCallback = refresh;
  if (mounted) {
    updateHints();
    updateHeader();
    return;
  }
  mounted = true;
  buildDock();
  bindKeyboard();
  bindPrefillEvent();
  if (sessionStorage.getItem('agent-dock-open') === '1') openDock();
}

function bindPrefillEvent() {
  window.addEventListener('agent:prefill', async (e) => {
    const text = e?.detail?.text ?? '';
    if (!panelEl.classList.contains('open')) await openDock();
    inputEl.value = text;
    inputEl.focus();
  });
}

function buildDock() {
  fabEl = el('button', {
    class: 'dock-fab', type: 'button', 'aria-label': 'Open academic agent',
    onclick: toggleDock,
  }, [fabIcon(), el('span', { class: 'dock-fab-dot' })]);
  document.body.appendChild(fabEl);

  panelEl = el('aside', { class: 'dock-panel', role: 'dialog', 'aria-label': 'Academic agent' });

  const header = el('header', { class: 'dock-head' }, [
    el('div', { class: 'dock-head-left' }, [
      el('span', { class: 'dock-pulse' }),
      el('div', { style: 'min-width:0;flex:1' }, [
        el('div', { class: 'dock-title' }, 'Academic agent'),
        el('div', { class: 'dock-ctx', id: 'dock-ctx' }, ''),
      ]),
    ]),
    el('div', { class: 'dock-head-actions' }, [
      el('a', { class: 'dock-btn-sub', href: '/agent.html', title: 'Open full-screen' }, 'Full view'),
      el('button', {
        class: 'dock-btn-x', type: 'button', 'aria-label': 'Close', onclick: closeDock,
      }, '×'),
    ]),
  ]);
  panelEl.appendChild(header);

  // Thread bar
  const threadBar = el('div', { class: 'dock-thread-bar' });
  threadChipEl = el('button', {
    class: 'dock-thread-chip', type: 'button',
    onclick: toggleThreadMenu, 'aria-haspopup': 'listbox',
  }, [
    el('span', { class: 'dock-thread-label', id: 'dock-thread-label' }, 'Inbox'),
    el('span', { class: 'dock-thread-caret' }, '▾'),
  ]);
  threadBar.appendChild(threadChipEl);
  threadBar.appendChild(el('button', {
    class: 'dock-btn-sub', type: 'button', title: 'New thread',
    onclick: createThread,
  }, '+ new'));
  threadBar.appendChild(el('button', {
    class: 'dock-btn-sub', type: 'button', title: 'Clear this thread',
    style: 'margin-left:auto',
    onclick: clearCurrentThread,
  }, 'Clear'));
  panelEl.appendChild(threadBar);

  threadMenuEl = el('div', { class: 'dock-thread-menu', id: 'dock-thread-menu', hidden: '' });
  panelEl.appendChild(threadMenuEl);

  messagesEl = el('div', { class: 'dock-messages' });
  panelEl.appendChild(messagesEl);

  const hintsRow = el('div', { class: 'dock-hints', id: 'dock-hints' });
  panelEl.appendChild(hintsRow);

  formEl = el('form', { class: 'dock-form' });
  inputEl = el('textarea', {
    class: 'dock-input', rows: '1',
    placeholder: 'Ask anything or type /',
  });
  sendBtn = el('button', { class: 'dock-send', type: 'submit', 'aria-label': 'Send' }, sendIcon());
  formEl.appendChild(inputEl);
  formEl.appendChild(sendBtn);
  panelEl.appendChild(formEl);

  document.body.appendChild(panelEl);

  formEl.addEventListener('submit', onSubmit);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); formEl.requestSubmit(); }
  });

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!threadMenuEl.hidden && !threadMenuEl.contains(e.target) && !threadChipEl.contains(e.target)) {
      threadMenuEl.hidden = true;
    }
  });

  updateHints();
  updateHeader();
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault();
      toggleDock();
    } else if (e.key === 'Escape' && panelEl.classList.contains('open')) {
      if (!threadMenuEl.hidden) { threadMenuEl.hidden = true; return; }
      closeDock();
    }
  });
}

function toggleDock() {
  if (panelEl.classList.contains('open')) closeDock();
  else openDock();
}

async function openDock() {
  panelEl.classList.add('open');
  fabEl.classList.add('active');
  sessionStorage.setItem('agent-dock-open', '1');
  await refreshThreads();
  if (!currentThreadId && threads.length) currentThreadId = threads[0].id;
  await loadHistory();
  updateThreadUi();
  setTimeout(() => inputEl.focus(), 180);
}

function closeDock() {
  panelEl.classList.remove('open');
  fabEl.classList.remove('active');
  sessionStorage.removeItem('agent-dock-open');
  threadMenuEl.hidden = true;
}

async function refreshThreads() {
  threads = await api.get('/api/agent/threads');
  const saved = Number(sessionStorage.getItem('agent-dock-thread') ?? 0);
  if (saved && threads.find(t => t.id === saved && !t.archived)) {
    currentThreadId = saved;
  } else if (!currentThreadId || !threads.find(t => t.id === currentThreadId)) {
    const firstActive = threads.find(t => !t.archived);
    currentThreadId = firstActive?.id ?? threads[0]?.id ?? null;
  }
  if (currentThreadId) sessionStorage.setItem('agent-dock-thread', String(currentThreadId));
}

function updateThreadUi() {
  const label = document.getElementById('dock-thread-label');
  const current = threads.find(t => t.id === currentThreadId);
  if (label && current) label.textContent = current.title;

  threadMenuEl.innerHTML = '';
  const active = threads.filter(t => !t.archived);
  const archived = threads.filter(t => t.archived);
  const groupLabel = (text) => el('div', { class: 'dock-thread-menu-label' }, text);

  if (active.length) threadMenuEl.appendChild(groupLabel('Active'));
  for (const t of active) threadMenuEl.appendChild(threadMenuItem(t));
  if (archived.length) threadMenuEl.appendChild(groupLabel('Archived'));
  for (const t of archived) threadMenuEl.appendChild(threadMenuItem(t));
}

function threadMenuItem(t) {
  const row = el('div', { class: 'dock-thread-item' + (t.id === currentThreadId ? ' current' : '') });
  row.appendChild(el('button', {
    class: 'dock-thread-item-main', type: 'button',
    onclick: async () => {
      currentThreadId = t.id;
      sessionStorage.setItem('agent-dock-thread', String(t.id));
      threadMenuEl.hidden = true;
      updateThreadUi();
      await loadHistory();
    },
  }, [
    el('span', { class: 'dock-thread-item-title' }, t.title),
    el('span', { class: 'dock-thread-item-count' }, `${t.message_count ?? 0}`),
  ]));
  row.appendChild(el('button', {
    class: 'dock-thread-item-act', type: 'button', title: 'Rename',
    onclick: async (e) => {
      e.stopPropagation();
      const next = prompt('Thread title:', t.title);
      if (!next || next === t.title) return;
      await api.patch(`/api/agent/threads/${t.id}`, { title: next });
      await refreshThreads();
      updateThreadUi();
    },
  }, '✎'));
  row.appendChild(el('button', {
    class: 'dock-thread-item-act', type: 'button', title: t.archived ? 'Unarchive' : 'Archive',
    onclick: async (e) => {
      e.stopPropagation();
      await api.patch(`/api/agent/threads/${t.id}`, { archived: !t.archived });
      await refreshThreads();
      if (t.id === currentThreadId && !t.archived) {
        const next = threads.find(x => !x.archived);
        currentThreadId = next?.id ?? null;
        sessionStorage.setItem('agent-dock-thread', String(currentThreadId ?? ''));
        await loadHistory();
      }
      updateThreadUi();
    },
  }, t.archived ? '↺' : '⛁'));
  return row;
}

async function createThread() {
  const title = prompt('New thread title:', 'New thread');
  if (!title) return;
  const created = await api.post('/api/agent/threads', { title });
  currentThreadId = created.id;
  sessionStorage.setItem('agent-dock-thread', String(currentThreadId));
  threadMenuEl.hidden = true;
  await refreshThreads();
  updateThreadUi();
  await loadHistory();
}

async function clearCurrentThread() {
  if (!currentThreadId) return;
  if (!confirm('Clear messages in this thread?')) return;
  await api.del(`/api/agent/messages?thread_id=${currentThreadId}`);
  await loadHistory();
  await refreshThreads();
  updateThreadUi();
  toast('Thread cleared', 'success');
}

function toggleThreadMenu() {
  threadMenuEl.hidden = !threadMenuEl.hidden;
}

function updateHints() {
  const row = panelEl?.querySelector('#dock-hints');
  if (!row) return;
  row.innerHTML = '';
  const { hints } = CONTEXT_CONFIG[currentContext] ?? CONTEXT_CONFIG.agent;
  for (const h of hints) {
    row.appendChild(el('button', {
      class: 'dock-hint', type: 'button',
      onclick: () => { inputEl.value = h.trim() + ' '; inputEl.focus(); },
    }, h.trim()));
  }
}

function updateHeader() {
  const ctxEl = panelEl?.querySelector('#dock-ctx');
  if (!ctxEl) return;
  const cfg = CONTEXT_CONFIG[currentContext] ?? CONTEXT_CONFIG.agent;
  ctxEl.textContent = `Context · ${cfg.label}`;
}

async function loadHistory() {
  if (!currentThreadId) { messagesEl.innerHTML = ''; return; }
  const messages = await api.get(`/api/agent/messages?thread_id=${currentThreadId}`);
  messagesEl.innerHTML = '';
  if (!messages.length) {
    const welcome = el('div', { class: 'dock-msg assistant' });
    const cfg = CONTEXT_CONFIG[currentContext] ?? CONTEXT_CONFIG.agent;
    welcome.innerHTML = renderMarkdown(
      `Hi — I'm your academic agent. On this page you'll probably want:\n\n` +
      cfg.hints.map(h => `- \`${h.trim()}\``).join('\n') +
      `\n\nType \`/help\` anytime. I won't write assessments for you.`
    );
    messagesEl.appendChild(welcome);
  } else {
    for (const m of messages) appendMessage(m.role, m.content);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(role, content) {
  const node = el('div', { class: `dock-msg ${role}` });
  if (role === 'assistant') node.innerHTML = renderMarkdown(content);
  else node.textContent = content;
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return node;
}

async function onSubmit(e) {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  appendMessage('user', text);
  sendBtn.disabled = true;
  const thinking = el('div', { class: 'dock-msg assistant dock-thinking' }, 'Thinking…');
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  try {
    const res = await api.post('/api/agent/message', { text, context: currentContext, thread_id: currentThreadId });
    thinking.remove();
    appendMessage('assistant', res.reply);
    if (res.thread_id && res.thread_id !== currentThreadId) {
      currentThreadId = res.thread_id;
      await refreshThreads();
      updateThreadUi();
    }
    if (MUTATING_COMMANDS.test(text) && typeof refreshCallback === 'function') {
      try { await refreshCallback(); } catch (err) { /* best-effort */ }
      // Also broadcast so other mounted views (e.g. nudges on dashboard) can refresh
      document.dispatchEvent(new CustomEvent('agent:mutated', { detail: { command: text } }));
    }
  } catch (err) {
    thinking.remove();
    toast(err.message ?? 'Request failed', 'error');
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

function fabIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML =
    '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12Z"/>' +
    '<path d="M8 12h.01M12 12h.01M16 12h.01"/>';
  svg.setAttribute('class', 'dock-fab-icon');
  return svg;
}
function sendIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>';
  svg.setAttribute('class', 'dock-send-icon');
  return svg;
}
