import { api, el, initShell, renderMarkdown, toast } from './app.js';

initShell({ active: 'agent', crumb: 'Agent' });
const page = document.getElementById('page');

let threads = [];
let currentThreadId = null;
let messagesEl, inputEl, formEl, sendBtn, threadListEl, currentTitleEl;

page.appendChild(el('div', { class: 'page-head' }, [
  el('h1', { class: 'page-title', html: 'Academic <span class="it">agent</span>' }),
  el('div', { class: 'page-sub', html:
    'Conversation threads scoped to your student account. The same history is available in the floating dock on every page. I won\'t complete assessments for you.' }),
]));

const layout = el('div', { class: 'agent-layout' });

// Thread sidebar
const sidebar = el('aside', { class: 'agent-threads' });
sidebar.appendChild(el('div', { class: 'agent-threads-head' }, [
  el('div', { class: 'agent-threads-title' }, 'Threads'),
  el('button', { class: 'btn sm pri', onclick: onNewThread }, '+ New'),
]));
threadListEl = el('div', { class: 'agent-threads-list' });
sidebar.appendChild(threadListEl);
layout.appendChild(sidebar);

// Main chat
const main = el('div', { class: 'agent-chat' });
main.appendChild(el('div', { class: 'agent-chat-head' }, [
  el('div', { class: 'agent-chat-title', id: 'agent-current-title' }, '—'),
  el('div', { style: 'display:flex;gap:6px' }, [
    el('button', { class: 'btn sm ghost', onclick: renameCurrent }, 'Rename'),
    el('button', { class: 'btn sm ghost', onclick: archiveCurrent }, 'Archive'),
    el('button', { class: 'btn sm ghost', onclick: clearCurrent }, 'Clear'),
  ]),
]));
currentTitleEl = main.querySelector('#agent-current-title');
messagesEl = el('div', { class: 'agent-chat-messages' });
main.appendChild(messagesEl);

const hints = el('div', { class: 'chat-hints' });
for (const h of ['/help', '/schedule', '/progress', '/plan', '/deadlines', '/facts', '/remember ']) {
  hints.appendChild(el('span', {
    class: 'chat-hint',
    onclick: () => { inputEl.value = h.trim() + ' '; inputEl.focus(); },
  }, h.trim()));
}
main.appendChild(hints);

formEl = el('form', { class: 'chat-form' });
inputEl = el('textarea', { class: 'chat-input', rows: '1', placeholder: 'Ask anything or use / to run a command' });
sendBtn = el('button', { class: 'btn pri', type: 'submit' }, 'Send');
formEl.appendChild(inputEl);
formEl.appendChild(sendBtn);
main.appendChild(formEl);
layout.appendChild(main);

page.appendChild(layout);

formEl.addEventListener('submit', onSubmit);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); formEl.requestSubmit(); }
});

await refreshThreads();
if (threads.length) {
  currentThreadId = threads.find(t => !t.archived)?.id ?? threads[0].id;
}
await loadHistory();
renderThreadList();
inputEl.focus();

async function refreshThreads() {
  threads = await api.get('/api/agent/threads');
}

function renderThreadList() {
  threadListEl.innerHTML = '';
  const active = threads.filter(t => !t.archived);
  const archived = threads.filter(t => t.archived);

  if (active.length) threadListEl.appendChild(groupLabel('Active'));
  for (const t of active) threadListEl.appendChild(threadRow(t));
  if (archived.length) threadListEl.appendChild(groupLabel('Archived'));
  for (const t of archived) threadListEl.appendChild(threadRow(t));

  const current = threads.find(t => t.id === currentThreadId);
  if (current && currentTitleEl) currentTitleEl.textContent = current.title;
}

function groupLabel(text) {
  return el('div', { class: 'agent-threads-group' }, text);
}

function threadRow(t) {
  const isCurrent = t.id === currentThreadId;
  const row = el('button', {
    class: 'agent-thread-row' + (isCurrent ? ' current' : '') + (t.archived ? ' archived' : ''),
    type: 'button',
    onclick: async () => {
      currentThreadId = t.id;
      await loadHistory();
      renderThreadList();
      inputEl.focus();
    },
  }, [
    el('div', { class: 'agent-thread-row-title' }, t.title),
    el('div', { class: 'agent-thread-row-meta' }, [
      el('span', {}, `${t.message_count ?? 0} msg${(t.message_count ?? 0) === 1 ? '' : 's'}`),
      t.archived ? el('span', { class: 'agent-thread-archived-badge' }, 'archived') : null,
    ]),
  ]);
  return row;
}

async function loadHistory() {
  if (!currentThreadId) { messagesEl.innerHTML = ''; return; }
  const messages = await api.get(`/api/agent/messages?thread_id=${currentThreadId}`);
  messagesEl.innerHTML = '';
  if (!messages.length) {
    const welcome = el('div', { class: 'chat-msg assistant' });
    welcome.innerHTML = renderMarkdown(
      `Hi — I'm your academic agent. I know your study plan, timetable, progress, deadlines, and what you've told me to remember.\n\n` +
      `Try \`/help\`, \`/facts\`, or just ask a question.`);
    messagesEl.appendChild(welcome);
  } else {
    for (const m of messages) appendMessage(m.role, m.content);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(role, content) {
  const node = el('div', { class: `chat-msg ${role}` });
  if (role === 'assistant') node.innerHTML = renderMarkdown(content);
  else node.textContent = content;
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function onSubmit(e) {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  appendMessage('user', text);
  sendBtn.disabled = true;
  const thinking = el('div', { class: 'chat-msg assistant muted' }, 'Thinking…');
  messagesEl.appendChild(thinking);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  try {
    const res = await api.post('/api/agent/message', { text, context: 'agent', thread_id: currentThreadId });
    thinking.remove();
    appendMessage('assistant', res.reply);
    if (res.thread_id) currentThreadId = res.thread_id;
    await refreshThreads();
    renderThreadList();
  } catch (err) {
    thinking.remove();
    toast(err.message ?? 'Request failed', 'error');
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

async function onNewThread() {
  const title = prompt('New thread title:', 'New thread');
  if (!title) return;
  const created = await api.post('/api/agent/threads', { title });
  currentThreadId = created.id;
  await refreshThreads();
  await loadHistory();
  renderThreadList();
  inputEl.focus();
}

async function renameCurrent() {
  const current = threads.find(t => t.id === currentThreadId);
  if (!current) return;
  const title = prompt('Thread title:', current.title);
  if (!title || title === current.title) return;
  await api.patch(`/api/agent/threads/${current.id}`, { title });
  await refreshThreads();
  renderThreadList();
}

async function archiveCurrent() {
  const current = threads.find(t => t.id === currentThreadId);
  if (!current) return;
  await api.patch(`/api/agent/threads/${current.id}`, { archived: !current.archived });
  await refreshThreads();
  if (!current.archived) {
    const firstActive = threads.find(t => !t.archived);
    currentThreadId = firstActive?.id ?? threads[0]?.id ?? null;
    await loadHistory();
  }
  renderThreadList();
}

async function clearCurrent() {
  if (!currentThreadId) return;
  if (!confirm('Clear messages in this thread?')) return;
  await api.del(`/api/agent/messages?thread_id=${currentThreadId}`);
  await refreshThreads();
  await loadHistory();
  renderThreadList();
  toast('Thread cleared', 'success');
}
