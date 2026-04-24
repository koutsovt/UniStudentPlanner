// Shared client utilities — LTU reference design

export const api = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    return res.json();
  },
  async del(path) {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    return res.json();
  },
};

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

// Thin-line SVGs sized 14x14 to match LTU reference
const ICONS = {
  home:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v12h14V9"/>',
  grid:      '<rect x="2" y="3" width="12" height="11" rx="1"/><line x1="2" y1="7" x2="14" y2="7"/><line x1="6" y1="3" x2="6" y2="14"/>',
  calendar:  '<rect x="2" y="3" width="12" height="11" rx="1"/><path d="M2 7h12M5 3v2M11 3v2M5 10h2M9 10h2"/>',
  clock:     '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2"/>',
  bars:      '<path d="M2 14V8M6 14V4M10 14V10M14 14V6"/>',
  bell:      '<path d="M4 7a4 4 0 0 1 8 0c0 4 2 5 2 5H2s2-1 2-5"/><path d="M7 14a1 1 0 0 0 2 0"/>',
  bot:       '<rect x="2" y="5" width="12" height="8" rx="1.5"/><path d="M8 2v3M5 10h.01M11 10h.01"/>',
  brain:     '<path d="M6 2a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H6z"/><path d="M6 5v6M10 5v6M6 8h4"/>',
  gear:      '<circle cx="8" cy="8" r="2.2"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.2 3.2l1.2 1.2M11.6 11.6l1.2 1.2M3.2 12.8l1.2-1.2M11.6 4.4l1.2-1.2"/>',
  chevron:   '<path d="m6 4 4 4-4 4"/>',
};

function burgerIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('class', 'topbar-burger-icon');
  svg.innerHTML = '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>';
  return svg;
}

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

export function initShell({ active, crumb }) {
  renderSidebar(active);
  renderTopbar(crumb);
  ensureSidebarDrawer();
}

// ─── Mobile sidebar drawer ───────────────────────────────────
let sidebarBackdrop = null;
function ensureSidebarDrawer() {
  if (sidebarBackdrop) return;
  sidebarBackdrop = el('div', {
    class: 'sidebar-backdrop',
    onclick: closeSidebar,
    'aria-hidden': 'true',
  });
  document.body.appendChild(sidebarBackdrop);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      closeSidebar();
    }
  });
}
export function openSidebar() {
  document.getElementById('sidebar-root')?.classList.add('open');
  sidebarBackdrop?.classList.add('open');
  document.body.classList.add('sidebar-open');
}
export function closeSidebar() {
  document.getElementById('sidebar-root')?.classList.remove('open');
  sidebarBackdrop?.classList.remove('open');
  document.body.classList.remove('sidebar-open');
}
function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

function renderSidebar(active) {
  const host = document.getElementById('sidebar-root');
  if (!host) return;
  host.innerHTML = '';

  host.appendChild(el('a', { class: 'brand', href: '/', 'aria-label': 'La Trobe Study Planner — Overview' }, [
    el('img', {
      class: 'brand-logo',
      src: '/assets/latrobe-logo.png',
      alt: 'La Trobe University',
    }),
    el('div', { class: 'brand-divider' }),
    el('div', { class: 'brand-sub' }, 'Study Planner'),
  ]));

  const sec = el('div', { class: 'nav-sec' });
  sec.appendChild(el('div', { class: 'lbl' }, 'Workspace'));
  const nav = [
    { id: 'dashboard', href: '/',                label: 'Overview',      icon: 'home' },
    { id: 'planner',   href: '/planner.html',    label: 'Plan my degree', icon: 'grid' },
    { id: 'timetable', href: '/timetable.html',  label: 'Timetable',      icon: 'calendar' },
    { id: 'progress',  href: '/progress.html',   label: 'Track progress', icon: 'bars' },
    { id: 'reminders', href: '/reminders.html',  label: 'Reminders',      icon: 'bell' },
    { id: 'facts',     href: '/facts.html',      label: 'What I know',    icon: 'brain' },
    { id: 'agent',     href: '/agent.html',      label: 'Agent',          icon: 'bot' },
  ];
  for (const item of nav) {
    const a = el('a', {
      class: 'nav-btn' + (item.id === active ? ' active' : ''),
      href: item.href,
      onclick: () => { if (matchMedia('(max-width: 768px)').matches) closeSidebar(); },
    }, [icon(item.icon), item.label]);
    sec.appendChild(a);
  }
  host.appendChild(sec);

  const foot = el('div', { class: 'sidebar-foot' });
  // Settings sits at the bottom, just above the profile card — separate from primary nav
  foot.appendChild(el('a', {
    class: 'nav-btn settings-nav-btn' + (active === 'settings' ? ' active' : ''),
    href: '/settings.html',
    onclick: () => { if (matchMedia('(max-width: 768px)').matches) closeSidebar(); },
  }, [icon('gear'), 'Settings']));
  host.appendChild(foot);
  api.get('/api/student').then(s => {
    foot.innerHTML = '';
    foot.appendChild(el('a', {
      class: 'sidebar-profile-card' + (active === 'settings' ? ' active' : ''),
      href: '/settings.html',
      'aria-label': 'Open settings — profile, appearance, privacy',
    }, [
      avatar(s, 34),
      el('div', { class: 'sidebar-profile-text' }, [
        el('div', { class: 'who' }, s.full_name),
        el('div', { class: 'id' }, `${s.program_code} · Year ${s.year_level}`),
      ]),
      icon('gear'),
    ]));
    foot.appendChild(el('div', { class: 'brand-line' }, [
      el('span', { class: 'brand-line-mark' }),
      'La Trobe University',
    ]));
  });
}

function renderTopbar(crumb) {
  const host = document.getElementById('topbar-root');
  if (!host) return;
  host.innerHTML = '';

  const burger = el('button', {
    class: 'topbar-burger', type: 'button',
    'aria-label': 'Open navigation menu',
    onclick: toggleSidebar,
  }, burgerIcon());
  const crumbs = el('div', { class: 'crumbs' }, [
    el('span', { class: 'crumb-root' }, 'La Trobe'),
    el('span', { class: 'sep' }, '›'),
    el('span', { class: 'crumb-mid' }, 'Bachelor of Computer Science'),
    el('span', { class: 'sep' }, '›'),
    el('span', { class: 'cur' }, crumb ?? ''),
  ]);
  const topLeft = el('div', { class: 'topbar-left' }, [burger, crumbs]);
  const actions = el('div', { class: 'top-actions' }, [
    el('div', { class: 'sync', title: 'Synced with SISOne · SAP PI/PO' }, [
      el('span', { class: 'dot' }),
      'Synced',
      el('span', { class: 'tm' }, '· 2 min ago'),
      el('span', { class: 'br-tag' }, 'BR01-38c'),
    ]),
    buildThemeToggle(),
    el('label', { class: 'toggle' }, [
      el('input', { type: 'checkbox', id: 'brd-overlay' }),
      'BRD overlay',
    ]),
    el('div', { class: 'avatar-holder', id: 'topbar-avatar' }),
  ]);
  host.appendChild(topLeft);
  host.appendChild(actions);

  document.getElementById('brd-overlay').addEventListener('change', (e) => {
    document.body.classList.toggle('show-overlay', e.target.checked);
  });

  api.get('/api/student').then(s => {
    const host = document.getElementById('topbar-avatar');
    host.replaceWith(avatar(s, 32));
  });
}

// ─── Avatar helper ───────────────────────────────────────────
// Looks up /assets/students/{student_id}.{png|jpg|svg} — if found, shows photo.
// Otherwise falls back to a stylised initials circle coloured by student id.
export function avatar(student, size = 32) {
  const wrap = el('div', {
    class: 'avatar avatar-size',
    style: `--avatar-size:${size}px`,
    title: student.full_name,
  });
  const initials = student.full_name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const hue = hashHue(student.student_id || student.id);
  const initialsEl = el('div', {
    class: 'avatar-initials',
    style: `background: linear-gradient(135deg, hsl(${hue} 60% 44%) 0%, hsl(${(hue + 20) % 360} 65% 32%) 100%);`,
  }, initials);
  wrap.appendChild(initialsEl);

  // Try photo lookup — if the PNG exists, swap the initials for it.
  const photoUrl = `/assets/students/${student.student_id}.png`;
  const probe = new Image();
  probe.onload = () => {
    wrap.classList.add('has-photo');
    const img = el('img', {
      class: 'avatar-img',
      src: photoUrl,
      alt: student.full_name,
      loading: 'lazy',
    });
    initialsEl.replaceWith(img);
  };
  probe.src = photoUrl;
  return wrap;
}

function hashHue(seed) {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  // Weight towards LTU red family — stay in warm hues (340–40° wrap)
  const palette = [353, 14, 28, 5, 340];
  return palette[Math.abs(h) % palette.length];
}

// ─── Theme toggle (light / dark / auto) ──────────────────────
export const THEMES = ['light', 'dark', 'auto'];

export function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'auto';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
}

export function currentTheme() {
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
}

function buildThemeToggle() {
  const group = el('div', { class: 'theme-toggle', role: 'radiogroup', 'aria-label': 'Theme' });
  for (const t of THEMES) {
    const btn = el('button', {
      type: 'button',
      class: 'theme-btn' + (currentTheme() === t ? ' on' : ''),
      role: 'radio',
      'aria-checked': currentTheme() === t ? 'true' : 'false',
      title: t[0].toUpperCase() + t.slice(1) + ' mode',
      'data-theme-value': t,
      onclick: () => {
        applyTheme(t);
        for (const b of group.children) {
          const active = b.dataset.themeValue === t;
          b.classList.toggle('on', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        }
      },
    }, themeIcon(t));
    group.appendChild(btn);
  }
  return group;
}

function themeIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'theme-icon');
  const paths = {
    light: '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4"/>',
    dark:  '<path d="M13 9.5A5 5 0 0 1 6.5 3a6 6 0 1 0 6.5 6.5Z"/>',
    auto:  '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12V2Z" fill="currentColor"/>',
  };
  svg.innerHTML = paths[name] ?? paths.auto;
  return svg;
}

// Apply persisted theme as early as possible (before paint)
applyTheme(currentTheme());

export function toast(message, kind = '') {
  const t = el('div', { class: `toast ${kind}` }, message);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// Minimal markdown (bold, code, bullets)
export function renderMarkdown(text) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inlineMd(line.replace(/^\s*-\s+/,'')) + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') html += '';
      else html += '<p>' + inlineMd(line) + '</p>';
    }
  }
  if (inList) html += '</ul>';
  return html;

  function inlineMd(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
}

export const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

export function formatDue(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-AU', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

export function humanPeriod(code) {
  // SEM1-2024 -> Sem 1, 2024
  const m = /^SEM(\d)-(\d{4})$/.exec(code);
  return m ? `Sem ${m[1]}, ${m[2]}` : code;
}

export function shortPeriod(code) {
  const m = /^SEM(\d)-(\d{4})$/.exec(code);
  return m ? `Year ${m[2]}-${m[1]}` : code;
}
