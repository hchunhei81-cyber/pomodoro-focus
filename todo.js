import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ============================================================
   CONFIG
   ============================================================ */
const SUPABASE_URL = 'https://mrdjzcaiqrkygxkgoajh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yZGp6Y2FpcXJreWd4a2dvYWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMzMwODQsImV4cCI6MjEwNjkwOTA4NH0.ftXZtwLGYMge2MtejHYfKyQ_AURvYlQ2G1rnuqGgOhY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

/* ============================================================
   STATE
   ============================================================ */
const state = {
  user: null,
  tasks: [],
  filter: 'all',
  search: '',
  authMode: 'signin',
  realtimeChannel: null,
  entering: false,
  pendingIds: new Set(),
  suppressRealtime: false,
  editingId: null,
  focusedId: null,
  selectedIds: new Set(),
  selectMode: false,
  submitting: false,
  toastTimer: null,
  toastUndo: null,
  undoStack: [],
  offlineQueue: [],
  renderQueued: false,
  nodeCache: new Map(),
  pomoTimer: null,
  pomoRemaining: 25 * 60,
  pomoRunning: false,
  exampleSeeded: false
};

/* ============================================================
   DOM
   ============================================================ */
const $ = (id) => document.getElementById(id);
const els = {
  authScreen: $('authScreen'), todoScreen: $('todoScreen'),
  authForm: $('authForm'), authEmail: $('authEmail'), authPassword: $('authPassword'),
  authSubmit: $('authSubmit'), authError: $('authError'), authInfo: $('authInfo'),
  authTabs: document.querySelectorAll('.auth-tab'),
  forgotBtn: $('forgotBtn'), githubBtn: $('githubBtn'),
  userEmail: $('userEmail'), signOutBtn: $('signOutBtn'),
  themeBtn: $('themeBtn'), helpBtn: $('helpBtn'),
  taskForm: $('taskForm'), taskInput: $('taskInput'), addBtn: $('addBtn'),
  searchInput: $('searchInput'), taskList: $('taskList'), emptyState: $('emptyState'),
  skeleton: $('skeleton'), statsText: $('statsText'),
  clearDoneBtn: $('clearDoneBtn'), selectModeBtn: $('selectModeBtn'),
  exportBtn: $('exportBtn'), filters: document.querySelectorAll('.filter'),
  syncStatus: $('syncStatus'), syncText: $('syncText'), offlineCount: $('offlineCount'),
  toast: $('toast'), toastMsg: $('toastMsg'), toastUndo: $('toastUndo'),
  helpPanel: $('helpPanel'), helpClose: $('helpClose'),
  palette: $('palette'), paletteInput: $('paletteInput'), paletteList: $('paletteList'),
  bulkBar: $('bulkBar'), bulkCount: $('bulkCount'),
  bulkDone: $('bulkDone'), bulkDelete: $('bulkDelete'), bulkCancel: $('bulkCancel'),
  statWeek: $('statWeek'), statStreak: $('statStreak'), statTotal: $('statTotal'),
  pomo: $('pomo'), pomoTime: $('pomoTime'), pomoToggle: $('pomoToggle'), pomoClose: $('pomoClose'),
  offlineBanner: $('offlineBanner')
};

/* ============================================================
   UTILITIES
   ============================================================ */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function throttle(fn, ms) {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) { last = now; fn(...a); }
    else if (!timer) {
      timer = setTimeout(() => { last = Date.now(); timer = null; fn(...a); }, remaining);
    }
  };
}
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============================================================
   SMART INPUT PARSER
   ============================================================ */
const DAY_NAMES = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
function parseTaskInput(raw) {
  let text = String(raw || '').trim();
  let priority = null;
  const tags = [];
  let due = null;

  // priority: !high !medium !low
  const pm = text.match(/\s!(high|medium|low|h|m|l)\b/i);
  if (pm) {
    const map = { h: 'high', m: 'medium', l: 'low' };
    const v = pm[1].toLowerCase();
    priority = map[v] || v;
    text = text.replace(pm[0], ' ');
  }

  // tags: #tag
  text = text.replace(/\s#([\w-]+)/g, (_, t) => { tags.push(t); return ' '; });

  // due: @today @tomorrow @monday @2024-01-01
  const dm = text.match(/\s@(\S+)/);
  if (dm) {
    const v = dm[1].toLowerCase();
    const now = new Date();
    if (v === 'today') due = startOfDay(now).toISOString();
    else if (v === 'tomorrow') due = startOfDay(new Date(now.getTime() + 86400000)).toISOString();
    else if (DAY_NAMES[v] !== undefined) {
      const d = startOfDay(now);
      const diff = (DAY_NAMES[v] - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      due = d.toISOString();
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      due = new Date(v + 'T00:00:00').toISOString();
    }
    if (due) text = text.replace(dm[0], ' ');
  }

  return { text: text.replace(/\s+/g, ' ').trim(), priority, tags, due_date: due };
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/* ============================================================
   UI HELPERS
   ============================================================ */
function setSync(status, text) {
  els.syncStatus.classList.remove('syncing', 'error');
  if (status === 'syncing') els.syncStatus.classList.add('syncing');
  if (status === 'error') els.syncStatus.classList.add('error');
  els.syncText.textContent = text;
  updateOfflineCount();
}
function updateOfflineCount() {
  const n = state.offlineQueue.length;
  if (n > 0) {
    els.offlineCount.textContent = ` • ${n} pending`;
    els.offlineCount.classList.remove('hidden');
  } else {
    els.offlineCount.classList.add('hidden');
  }
}
function showAuthError(msg) {
  els.authError.textContent = msg;
  els.authError.classList.remove('hidden');
  els.authInfo.classList.add('hidden');
}
function showAuthInfo(msg) {
  els.authInfo.textContent = msg;
  els.authInfo.classList.remove('hidden');
  els.authError.classList.add('hidden');
}
function clearAuthMessages() {
  els.authError.classList.add('hidden');
  els.authInfo.classList.add('hidden');
}
function showToast(msg, undoFn = null) {
  els.toastMsg.textContent = msg;
  els.toast.classList.remove('hidden');
  if (undoFn) {
    state.toastUndo = undoFn;
    els.toastUndo.classList.remove('hidden');
  } else {
    state.toastUndo = null;
    els.toastUndo.classList.add('hidden');
  }
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.add('hidden'), undoFn ? 5000 : 2400);
}
function setAuthMode(mode) {
  state.authMode = mode;
  els.authTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  els.authSubmit.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
  els.authPassword.setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
  clearAuthMessages();
}

/* ============================================================
   THEME
   ============================================================ */
const THEME_KEY = 'cloudtodo.theme';
function applyTheme(pref) {
  const root = document.documentElement;
  let theme = pref;
  if (pref === 'system') {
    theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.dataset.theme = theme;
  els.themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  document.querySelector('meta[name="theme-color"]').setAttribute(
    'content', theme === 'light' ? '#f8fafc' : '#0b1120'
  );
}
function initTheme() {
  const pref = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(pref);
  els.themeBtn.addEventListener('click', () => {
    const cur = localStorage.getItem(THEME_KEY) || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'dark') === 'system') applyTheme('system');
  });
}

/* ============================================================
   AUTH
   ============================================================ */
async function handleAuthSubmit(e) {
  e.preventDefault();
  clearAuthMessages();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return showAuthError('Email and password are required.');
  if (password.length < 6) return showAuthError('Password must be at least 6 characters.');

  els.authSubmit.disabled = true;
  const original = els.authSubmit.textContent;
  els.authSubmit.textContent = state.authMode === 'signin' ? 'Signing in...' : 'Creating account...';

  try {
    if (state.authMode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session) showAuthInfo('Account created. You are now signed in.');
      else {
        showAuthInfo('Account created. Check your email to confirm, then sign in.');
        setAuthMode('signin');
      }
    }
  } catch (err) {
    showAuthError(err.message || 'Something went wrong.');
  } finally {
    els.authSubmit.disabled = false;
    els.authSubmit.textContent = original;
  }
}
async function signOut() {
  const pending = state.offlineQueue.length + state.pendingIds.size;
  if (pending > 0 && !confirm(`You have ${pending} unsynced change(s). Sign out anyway?`)) return;
  try { await supabase.auth.signOut(); }
  catch (err) { console.error(err); showToast('Sign out failed. Try again.'); }
}
async function handleForgot() {
  const email = els.authEmail.value.trim();
  if (!email) return showAuthError('Enter your email first, then click "Forgot password?".');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (error) throw error;
    showAuthInfo('Password reset email sent. Check your inbox.');
  } catch (err) {
    showAuthError(err.message || 'Could not send reset email.');
  }
}
async function handleGithub() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) throw error;
  } catch (err) {
    showAuthError(err.message || 'GitHub sign-in failed.');
  }
}

function enterApp(user) {
  if (state.entering) return;
  if (state.user && state.user.id === user.id) return;
  state.entering = true;
  state.user = user;

  els.authScreen.classList.add('hidden');
  els.todoScreen.classList.remove('hidden');
  els.userEmail.classList.remove('hidden');
  els.userEmail.textContent = user.email || '';
  els.signOutBtn.classList.remove('hidden');
  els.taskInput.focus();

  loadOfflineQueue();
  loadTasks().finally(() => {
    subscribeRealtime();
    state.entering = false;
    flushOfflineQueue();
  });
}
function leaveApp() {
  state.user = null;
  state.tasks = [];
  state.filter = 'all';
  state.search = '';
  state.editingId = null;
  state.focusedId = null;
  state.selectedIds.clear();
  state.selectMode = false;
  state.pendingIds.clear();
  state.nodeCache.clear();
  state.undoStack = [];
  els.searchInput.value = '';
  els.filters.forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  els.authScreen.classList.remove('hidden');
  els.todoScreen.classList.add('hidden');
  els.userEmail.classList.add('hidden');
  els.signOutBtn.classList.add('hidden');
  els.authEmail.value = '';
  els.authPassword.value = '';
  els.bulkBar.classList.add('hidden');
  setAuthMode('signin');
  unsubscribeRealtime();
  setSync('ok', 'Ready');
}

/* ============================================================
   OFFLINE QUEUE
   ============================================================ */
const QUEUE_KEY = 'cloudtodo.queue';
function loadOfflineQueue() {
  try { state.offlineQueue = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { state.offlineQueue = []; }
  updateOfflineCount();
}
function saveOfflineQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(state.offlineQueue));
  updateOfflineCount();
}
function enqueue(op) {
  state.offlineQueue.push(op);
  saveOfflineQueue();
  setSync('error', 'Offline — queued');
}
async function flushOfflineQueue() {
  if (!navigator.onLine || !state.user || state.offlineQueue.length === 0) return;
  setSync('syncing', 'Syncing queued...');
  while (state.offlineQueue.length) {
    const op = state.offlineQueue[0];
    try {
      await replayOp(op);
      state.offlineQueue.shift();
      saveOfflineQueue();
    } catch (err) {
      console.error('Queue replay failed', err);
      setSync('error', 'Sync failed');
      return;
    }
  }
  setSync('ok', 'Synced');
  loadTasks();
}
async function replayOp(op) {
  if (op.type === 'insert') {
    const { error } = await supabase.from('tasks').insert(op.data);
    if (error) throw error;
  } else if (op.type === 'update') {
    const { error } = await supabase.from('tasks').update(op.data).eq('id', op.id).eq('user_id', state.user.id);
    if (error) throw error;
  } else if (op.type === 'delete') {
    const { error } = await supabase.from('tasks').delete().eq('id', op.id).eq('user_id', state.user.id);
    if (error) throw error;
  } else if (op.type === 'deleteMany') {
    const { error } = await supabase.from('tasks').delete().in('id', op.ids).eq('user_id', state.user.id);
    if (error) throw error;
  }
}

/* ============================================================
   TASKS
   ============================================================ */
async function loadTasks() {
  if (!state.user) return;
  els.skeleton.classList.remove('hidden');
  setSync('syncing', 'Loading...');
  try {
    const { data, error } = await supabase
      .from('tasks').select('*')
      .eq('user_id', state.user.id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1000);
    if (error) throw error;
    state.tasks = (data || []).map(normalizeTask);
    if (!state.exampleSeeded && state.tasks.length === 0) {
      state.exampleSeeded = true;
      await seedExampleTasks();
    }
    scheduleRender();
    updateStats();
    setSync('ok', 'Synced');
  } catch (err) {
    console.error(err);
    setSync('error', 'Failed to load');
    showToast('Could not load tasks.');
  } finally {
    els.skeleton.classList.add('hidden');
  }
}
function normalizeTask(t) {
  return {
    id: t.id,
    user_id: t.user_id,
    text: t.text,
    done: !!t.done,
    position: Number.isFinite(t.position) ? t.position : 0,
    notes: t.notes || '',
    due_date: t.due_date || null,
    priority: t.priority || null,
    tags: Array.isArray(t.tags) ? t.tags : [],
    created_at: t.created_at || new Date().toISOString(),
    updated_at: t.updated_at || t.created_at || new Date().toISOString()
  };
}
function nextPosition() {
  if (!state.tasks.length) return 0;
  return Math.max(...state.tasks.map(t => t.position || 0)) + 1;
}
async function seedExampleTasks() {
  const examples = [
    { text: 'Click the circle to complete a task', position: 0 },
    { text: 'Double-click text to edit', position: 1 },
    { text: 'Drag tasks to reorder them', position: 2 },
    { text: 'Try !high #work @tomorrow syntax', priority: 'high', tags: ['work'], position: 3 }
  ];
  for (const ex of examples) {
    try {
      await supabase.from('tasks').insert({
        id: uuid(), user_id: state.user.id, text: ex.text,
        done: false, position: ex.position,
        priority: ex.priority || null, tags: ex.tags || []
      });
    } catch (e) { console.warn('seed failed', e); }
  }
  const { data } = await supabase.from('tasks').select('*').eq('user_id', state.user.id).order('position');
  state.tasks = (data || []).map(normalizeTask);
}

/* ---- CRUD ---- */
async function addTask(rawText) {
  if (state.submitting) return;
  const parsed = parseTaskInput(rawText);
  if (!parsed.text) return;
  if (state.editingId) { state.editingId = null; }

  const id = uuid();
  const optimistic = {
    id, user_id: state.user.id, text: parsed.text, done: false,
    position: nextPosition(), notes: '', due_date: parsed.due_date,
    priority: parsed.priority, tags: parsed.tags,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  state.pendingIds.add(id);
  state.tasks.push(optimistic);
  scheduleRender();
  setSync('syncing', 'Saving...');
  state.submitting = true;

  const payload = {
    id, user_id: state.user.id, text: parsed.text, done: false,
    position: optimistic.position, due_date: parsed.due_date,
    priority: parsed.priority, tags: parsed.tags
  };

  try {
    if (!navigator.onLine) {
      enqueue({ type: 'insert', data: payload });
    } else {
      const { data, error } = await supabase.from('tasks').insert(payload).select().single();
      if (error) throw error;
      const idx = state.tasks.findIndex(t => t.id === id);
      if (idx !== -1) state.tasks[idx] = normalizeTask(data);
      setSync('ok', 'Synced');
    }
    pushUndo({
      label: 'Task added',
      undo: async () => {
        state.tasks = state.tasks.filter(t => t.id !== id);
        scheduleRender();
        try { await supabase.from('tasks').delete().eq('id', id).eq('user_id', state.user.id); } catch {}
      }
    });
    scheduleRender();
  } catch (err) {
    console.error(err);
    state.tasks = state.tasks.filter(t => t.id !== id);
    scheduleRender();
    setSync('error', 'Save failed');
    showToast('Could not add task.');
  } finally {
    state.pendingIds.delete(id);
    state.submitting = false;
  }
}

async function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || state.pendingIds.has(id)) return;
  const newDone = !task.done;
  const prev = task.done;
  task.done = newDone;
  task.updated_at = new Date().toISOString();
  state.pendingIds.add(id);
  scheduleRender();
  setSync('syncing', 'Saving...');

  try {
    if (!navigator.onLine) enqueue({ type: 'update', id, data: { done: newDone } });
    else {
      const { error } = await supabase.from('tasks').update({ done: newDone }).eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
    }
    setSync('ok', navigator.onLine ? 'Synced' : 'Offline — queued');
    updateStats();
    pushUndo({
      label: newDone ? 'Task completed' : 'Task reopened',
      undo: async () => { task.done = prev; scheduleRender(); await persistUpdate(id, { done: prev }); }
    });
  } catch (err) {
    console.error(err);
    task.done = prev;
    scheduleRender();
    setSync('error', 'Save failed');
    showToast('Could not update task.');
  } finally {
    state.pendingIds.delete(id);
  }
}

async function updateTaskText(id, text) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const clean = String(text).trim();
  if (!clean || clean === task.text) return;
  const prev = task.text;
  task.text = clean;
  state.pendingIds.add(id);
  scheduleRender();
  setSync('syncing', 'Saving...');
  try {
    await persistUpdate(id, { text: clean });
    setSync('ok', 'Synced');
    pushUndo({
      label: 'Task renamed',
      undo: async () => { task.text = prev; scheduleRender(); await persistUpdate(id, { text: prev }); }
    });
  } catch (err) {
    console.error(err);
    task.text = prev;
    scheduleRender();
    setSync('error', 'Save failed');
    showToast('Could not rename task.');
  } finally { state.pendingIds.delete(id); }
}

async function updateTaskNotes(id, notes) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  task.notes = notes;
  try { await persistUpdate(id, { notes }); } catch (e) { console.warn(e); }
}

async function persistUpdate(id, data) {
  if (!navigator.onLine) { enqueue({ type: 'update', id, data }); return; }
  const { error } = await supabase.from('tasks').update(data).eq('id', id).eq('user_id', state.user.id);
  if (error) throw error;
}

async function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const backup = { ...task };
  const idx = state.tasks.findIndex(t => t.id === id);
  state.tasks = state.tasks.filter(t => t.id !== id);
  state.pendingIds.add(id);
  scheduleRender();
  setSync('syncing', 'Saving...');
  try {
    if (!navigator.onLine) enqueue({ type: 'delete', id });
    else {
      const { error } = await supabase.from('tasks').delete().eq('id', id).eq('user_id', state.user.id);
      if (error) throw error;
    }
    setSync('ok', navigator.onLine ? 'Synced' : 'Offline — queued');
    updateStats();
    pushUndo({
      label: 'Task deleted',
      undo: async () => {
        state.tasks.splice(idx, 0, backup);
        scheduleRender();
        const payload = {
          id: backup.id, user_id: backup.user_id, text: backup.text, done: backup.done,
          position: backup.position, notes: backup.notes, due_date: backup.due_date,
          priority: backup.priority, tags: backup.tags
        };
        try { await supabase.from('tasks').insert(payload); } catch (e) { console.warn(e); }
      }
    });
  } catch (err) {
    console.error(err);
    state.tasks.splice(idx, 0, backup);
    scheduleRender();
    setSync('error', 'Delete failed');
    showToast('Could not delete task.');
  } finally { state.pendingIds.delete(id); }
}

async function clearDone() {
  const done = state.tasks.filter(t => t.done);
  if (!done.length) return;
  if (done.length > 5 && !confirm(`Delete ${done.length} completed tasks?`)) return;
  const backup = state.tasks.slice();
  const ids = done.map(t => t.id);
  state.tasks = state.tasks.filter(t => !t.done);
  ids.forEach(id => state.pendingIds.add(id));
  scheduleRender();
  setSync('syncing', 'Clearing...');
  try {
    if (!navigator.onLine) enqueue({ type: 'deleteMany', ids });
    else {
      const { error } = await supabase.from('tasks').delete().in('id', ids).eq('user_id', state.user.id);
      if (error) throw error;
    }
    setSync('ok', 'Synced');
    updateStats();
    showToast(`Cleared ${ids.length} task${ids.length === 1 ? '' : 's'}.`, async () => {
      state.tasks = backup;
      scheduleRender();
      for (const t of done) {
        try { await supabase.from('tasks').insert({ ...t }); } catch {}
      }
    });
  } catch (err) {
    console.error(err);
    state.tasks = backup;
    scheduleRender();
    setSync('error', 'Clear failed');
    showToast('Could not clear done tasks.');
  } finally { ids.forEach(id => state.pendingIds.delete(id)); }
}

async function bulkMarkDone() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const backup = state.tasks.map(t => ({ id: t.id, done: t.done }));
  state.tasks.forEach(t => { if (ids.includes(t.id)) t.done = true; });
  scheduleRender();
  try {
    for (const id of ids) {
      try { await persistUpdate(id, { done: true }); } catch {}
    }
    showToast(`Marked ${ids.length} as done.`);
    exitSelectMode();
    updateStats();
  } catch (e) { console.error(e); }
}
async function bulkDelete() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} task(s)?`)) return;
  const backup = state.tasks.slice();
  state.tasks = state.tasks.filter(t => !ids.includes(t.id));
  scheduleRender();
  try {
    if (!navigator.onLine) enqueue({ type: 'deleteMany', ids });
    else {
      const { error } = await supabase.from('tasks').delete().in('id', ids).eq('user_id', state.user.id);
      if (error) throw error;
    }
    showToast(`Deleted ${ids.length} task(s).`, () => { state.tasks = backup; scheduleRender(); });
    exitSelectMode();
    updateStats();
  } catch (e) { console.error(e); state.tasks = backup; scheduleRender(); }
}

/* ---- ORDER ---- */
const saveOrder = throttle(async () => {
  if (!state.user) return;
  setSync('syncing', 'Saving order...');
  state.suppressRealtime = true;
  try {
    if (!navigator.onLine) {
      for (const [i, t] of state.tasks.entries()) enqueue({ type: 'update', id: t.id, data: { position: i } });
    } else {
      const results = await Promise.all(
        state.tasks.map((t, i) =>
          supabase.from('tasks').update({ position: i }).eq('id', t.id).eq('user_id', state.user.id)
        )
      );
      const firstError = results.find(r => r.error);
      if (firstError) throw firstError.error;
    }
    state.tasks.forEach((t, i) => { t.position = i; });
    setSync('ok', 'Synced');
  } catch (err) {
    console.error(err);
    setSync('error', 'Order save failed');
    showToast('Could not save order.');
  } finally {
    setTimeout(() => { state.suppressRealtime = false; }, 400);
  }
}, 400);

/* ============================================================
   UNDO
   ============================================================ */
function pushUndo(action) {
  state.undoStack.push(action);
  if (state.undoStack.length > 30) state.undoStack.shift();
}
async function performUndo() {
  const action = state.undoStack.pop();
  if (!action) { showToast('Nothing to undo.'); return; }
  try {
    await action.undo();
    showToast(`Undid: ${action.label}`);
  } catch (e) {
    console.error(e);
    showToast('Undo failed.');
  }
}
els.toastUndo.addEventListener('click', async () => {
  if (state.toastUndo) {
    const fn = state.toastUndo;
    state.toastUndo = null;
    els.toast.classList.add('hidden');
    await fn();
  } else {
    await performUndo();
  }
});

/* ============================================================
   RENDER
   ============================================================ */
function visibleTasks() {
  const q = state.search.trim().toLowerCase();
  let list = state.tasks;
  if (state.filter === 'active') list = list.filter(t => !t.done);
  else if (state.filter === 'done') list = list.filter(t => t.done);
  if (q) list = list.filter(t =>
    t.text.toLowerCase().includes(q) ||
    (t.notes || '').toLowerCase().includes(q) ||
    (t.tags || []).some(tag => tag.toLowerCase().includes(q))
  );
  return list;
}

function scheduleRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderTasks();
  });
}

function updateCounts() {
  const all = state.tasks.length;
  const active = state.tasks.filter(t => !t.done).length;
  const done = all - active;
  document.querySelector('[data-count="all"]').textContent = all ? `(${all})` : '';
  document.querySelector('[data-count="active"]').textContent = active ? `(${active})` : '';
  document.querySelector('[data-count="done"]').textContent = done ? `(${done})` : '';
}

function updateEmptyState(list) {
  const hasAny = state.tasks.length > 0;
  const q = state.search.trim();
  if (list.length > 0) { els.emptyState.classList.add('hidden'); return; }
  els.emptyState.classList.remove('hidden');
  let msg = '';
  if (!hasAny) msg = 'No tasks yet. Add one above to get started.';
  else if (q) msg = `No tasks match "${q}".`;
  else if (state.filter === 'done') msg = 'No completed tasks yet.';
  else if (state.filter === 'active') msg = 'No active tasks. Nice work.';
  else msg = 'Nothing to show.';
  els.emptyState.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="4" width="18" height="16" rx="3"/>
      <path d="M8 10h8M8 14h5"/>
    </svg>${escapeHtml(msg)}`;
}

function renderTasks() {
  const list = visibleTasks();
  updateEmptyState(list);
  updateCounts();

  const seen = new Set();
  const frag = document.createDocumentFragment();

  for (const task of list) {
    seen.add(task.id);
    const existing = state.nodeCache.get(task.id);
    const li = buildOrPatchItem(existing, task);
    frag.appendChild(li);
  }

  // remove stale nodes
  for (const [id, node] of state.nodeCache.entries()) {
    if (!seen.has(id)) { node.remove(); state.nodeCache.delete(id); }
  }
  // reorder & append
  els.taskList.innerHTML = '';
  els.taskList.appendChild(frag);

  const active = state.tasks.filter(t => !t.done).length;
  els.statsText.textContent = `${active} active / ${state.tasks.length} total`;
  els.clearDoneBtn.classList.toggle('hidden', !state.tasks.some(t => t.done));
  els.selectModeBtn.textContent = state.selectMode ? 'Cancel' : 'Select';
  els.addBtn.disabled = !els.taskInput.value.trim();
  updateBulkBar();
}

function buildOrPatchItem(existing, task) {
  let li = existing;
  if (!li) {
    li = document.createElement('li');
    li.className = 'task-item';
    li.dataset.id = task.id;
    li.setAttribute('role', 'listitem');
    state.nodeCache.set(task.id, li);
  }

  const isOverdue = task.due_date && !task.done && new Date(task.due_date) < new Date();
  li.className = 'task-item'
    + (task.done ? ' done' : '')
    + (isOverdue ? ' overdue' : '')
    + (state.selectedIds.has(task.id) ? ' selected' : '')
    + (state.focusedId === task.id ? ' focused' : '');

  const draggable = state.filter === 'all' && !state.search.trim() && !state.editingId && !state.selectMode;
  li.draggable = draggable;

  // checkbox
  let check = li.querySelector('.task-check');
  if (!check) {
    check = document.createElement('button');
    check.type = 'button';
    check.className = 'task-check';
    check.dataset.action = 'toggle';
    li.appendChild(check);
  }
  check.className = 'task-check' + (task.done ? ' done' : '');
  check.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
  check.setAttribute('aria-checked', String(task.done));
  check.setAttribute('role', 'checkbox');
  check.innerHTML = task.done
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>'
    : '';

  // body
  let body = li.querySelector('.task-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'task-body';
    li.appendChild(body);
  }

  if (state.editingId === task.id) {
    body.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;
    input.maxLength = 200;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { if (state.editingId === task.id) commitEdit(input.value); }, 100);
    });
    body.appendChild(input);
    queueMicrotask(() => { input.focus(); input.select(); });

    const notes = document.createElement('textarea');
    notes.className = 'task-notes';
    notes.placeholder = 'Notes...';
    notes.value = task.notes || '';
    notes.addEventListener('blur', () => updateTaskNotes(task.id, notes.value.trim()));
    body.appendChild(notes);
  } else {
    body.innerHTML = '';
    const text = document.createElement('div');
    text.className = 'task-text';
    text.textContent = task.text;
    text.title = 'Double-click to edit';
    text.addEventListener('dblclick', () => { state.editingId = task.id; scheduleRender(); });
    body.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    let metaHtml = '';
    if (task.priority) metaHtml += `<span class="badge ${task.priority}">${escapeHtml(task.priority)}</span>`;
    if (task.due_date) {
      const due = new Date(task.due_date);
      const isOver = !task.done && due < new Date();
      metaHtml += `<span class="badge due${isOver ? ' overdue' : ''}">📅 ${escapeHtml(formatDue(due))}</span>`;
    }
    for (const tag of (task.tags || [])) metaHtml += `<span class="badge tag">#${escapeHtml(tag)}</span>`;
    if (task.notes) metaHtml += `<span class="badge">📝</span>`;
    meta.innerHTML = metaHtml;
    if (metaHtml) body.appendChild(meta);
  }

  // actions
  let actions = li.querySelector('.task-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'task-actions';
    li.appendChild(actions);
  }
  if (state.editingId !== task.id && !state.selectMode) {
    actions.innerHTML = `
      <button class="task-icon-btn" data-action="pomo" title="Pomodoro">⏱</button>
      <button class="task-icon-btn" data-action="edit" title="Edit">✎</button>
      <button class="task-icon-btn danger" data-action="delete" title="Delete">✕</button>
    `;
  } else if (state.editingId !== task.id) {
    actions.innerHTML = '';
  }

  // drag listeners (once)
  if (draggable && !li.dataset.dragBound) {
    li.dataset.dragBound = '1';
    li.addEventListener('dragstart', onDragStart);
    li.addEventListener('dragover', onDragOver);
    li.addEventListener('dragleave', onDragLeave);
    li.addEventListener('drop', onDrop);
    li.addEventListener('dragend', onDragEnd);
  }

  return li;
}

function formatDue(d) {
  const now = new Date();
  const today = startOfDay(now);
  const target = startOfDay(d);
  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays < 0) return `${-diffDays}d overdue`;
  if (diffDays < 7) return `in ${diffDays}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function commitEdit(val) {
  const id = state.editingId;
  state.editingId = null;
  const task = state.tasks.find(t => t.id === id);
  if (task && val.trim() && val.trim() !== task.text) updateTaskText(id, val);
  else scheduleRender();
}
function cancelEdit() {
  state.editingId = null;
  scheduleRender();
}

/* ============================================================
   EVENT DELEGATION on taskList
   ============================================================ */
els.taskList.addEventListener('click', (e) => {
  const li = e.target.closest('.task-item');
  if (!li) return;
  const id = li.dataset.id;
  if (state.selectMode) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
    scheduleRender();
    return;
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) {
    state.focusedId = id;
    return;
  }
  if (action === 'toggle') toggleTask(id);
  else if (action === 'edit') { state.editingId = id; scheduleRender(); }
  else if (action === 'delete') deleteTask(id);
  else if (action === 'pomo') openPomodoro();
});

/* ============================================================
   DRAG & DROP
   ============================================================ */
let draggedId = null;
function onDragStart(e) {
  draggedId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', draggedId); } catch {}
}
function onDragOver(e) {
  e.preventDefault();
  const li = e.currentTarget;
  if (li.dataset.id === draggedId) return;
  const rect = li.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  li.classList.toggle('drop-after', after);
  li.classList.toggle('drop-before', !after);
}
function onDragLeave(e) {
  e.currentTarget.classList.remove('drop-before', 'drop-after');
}
function onDrop(e) {
  e.preventDefault();
  const targetLi = e.currentTarget;
  const targetId = targetLi.dataset.id;
  targetLi.classList.remove('drop-before', 'drop-after');
  if (!draggedId || draggedId === targetId) { draggedId = null; return; }

  const draggedIdx = state.tasks.findIndex(t => t.id === draggedId);
  const targetIdx = state.tasks.findIndex(t => t.id === targetId);
  if (draggedIdx === -1 || targetIdx === -1) { draggedId = null; return; }

  const rect = targetLi.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;

  const [moved] = state.tasks.splice(draggedIdx, 1);
  let insertIdx = targetIdx;
  if (draggedIdx < targetIdx) insertIdx -= 1;
  if (after) insertIdx += 1;
  state.tasks.splice(insertIdx, 0, moved);
  draggedId = null;
  scheduleRender();
  saveOrder();
}
function onDragEnd(e) {
  if (e?.currentTarget) e.currentTarget.classList.remove('dragging');
  draggedId = null;
  document.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
}

/* ============================================================
   REALTIME
   ============================================================ */
function subscribeRealtime() {
  if (!state.user || state.realtimeChannel) return;
  state.realtimeChannel = supabase
    .channel('tasks-' + state.user.id)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${state.user.id}` },
      (payload) => {
        if (state.suppressRealtime) return;
        if (payload.eventType === 'INSERT') {
          const incoming = normalizeTask(payload.new);
          if (state.pendingIds.has(incoming.id)) return;
          if (!state.tasks.find(t => t.id === incoming.id)) {
            state.tasks.push(incoming);
            state.tasks.sort((a, b) =>
              (a.position || 0) - (b.position || 0) ||
              String(a.created_at).localeCompare(String(b.created_at))
            );
            scheduleRender();
          }
        } else if (payload.eventType === 'UPDATE') {
          const incoming = normalizeTask(payload.new);
          if (state.pendingIds.has(incoming.id)) return;
          const idx = state.tasks.findIndex(t => t.id === incoming.id);
          if (idx !== -1) {
            const local = state.tasks[idx];
            if (new Date(incoming.updated_at) >= new Date(local.updated_at)) {
              state.tasks[idx] = incoming;
              scheduleRender();
            }
          }
        } else if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id;
          if (!removedId || state.pendingIds.has(removedId)) return;
          state.tasks = state.tasks.filter(t => t.id !== removedId);
          scheduleRender();
        }
      })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSync('error', 'Realtime offline');
    });
}
function unsubscribeRealtime() {
  if (state.realtimeChannel) {
    supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
}

/* ============================================================
   SELECT MODE
   ============================================================ */
function enterSelectMode() {
  state.selectMode = true;
  state.selectedIds.clear();
  scheduleRender();
}
function exitSelectMode() {
  state.selectMode = false;
  state.selectedIds.clear();
  scheduleRender();
}
function updateBulkBar() {
  if (!state.selectMode) { els.bulkBar.classList.add('hidden'); return; }
  els.bulkBar.classList.remove('hidden');
  els.bulkCount.textContent = `${state.selectedIds.size} selected`;
}

/* ============================================================
   EXPORT
   ============================================================ */
function exportMarkdown() {
  const lines = state.tasks.map(t => {
    const box = t.done ? '[x]' : '[ ]';
    const pri = t.priority ? ` !${t.priority}` : '';
    const tags = (t.tags || []).map(x => ` #${x}`).join('');
    const due = t.due_date ? ` @${new Date(t.due_date).toISOString().slice(0, 10)}` : '';
    return `- ${box} ${t.text}${pri}${tags}${due}`;
  });
  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cloud-todo-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported.');
}

/* ============================================================
   STATS
   ============================================================ */
function updateStats() {
  const done = state.tasks.filter(t => t.done);
  const weekAgo = Date.now() - 7 * 86400000;
  const week = done.filter(t => new Date(t.updated_at).getTime() >= weekAgo).length;

  const byDay = new Set();
  done.forEach(t => byDay.add(startOfDay(new Date(t.updated_at)).toISOString()));
  let streak = 0;
  const cur = startOfDay(new Date());
  while (byDay.has(cur.toISOString())) { streak++; cur.setDate(cur.getDate() - 1); }

  els.statWeek.textContent = week;
  els.statStreak.textContent = streak;
  els.statTotal.textContent = state.tasks.length;
}

/* ============================================================
   POMODORO
   ============================================================ */
function openPomodoro() {
  els.pomo.classList.remove('hidden');
}
function tickPomo() {
  if (!state.pomoRunning) return;
  state.pomoRemaining--;
  if (state.pomoRemaining <= 0) {
    clearInterval(state.pomoTimer);
    state.pomoRunning = false;
    state.pomoRemaining = 25 * 60;
    els.pomoToggle.textContent = 'Start';
    els.pomo.classList.remove('running');
    notify('Pomodoro complete!', 'Take a break.');
  }
  renderPomo();
}
function renderPomo() {
  const m = String(Math.floor(state.pomoRemaining / 60)).padStart(2, '0');
  const s = String(state.pomoRemaining % 60).padStart(2, '0');
  els.pomoTime.textContent = `${m}:${s}`;
}
function notify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') new Notification(title, { body });
  else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); });
  }
}

/* ============================================================
   COMMAND PALETTE
   ============================================================ */
const COMMANDS = [
  { id: 'new', label: 'New task', hint: 'N', run: () => els.taskInput.focus() },
  { id: 'search', label: 'Search tasks', hint: '/', run: () => els.searchInput.focus() },
  { id: 'all', label: 'Filter: All', run: () => { state.filter = 'all'; updateFilterButtons(); scheduleRender(); } },
  { id: 'active', label: 'Filter: Active', run: () => { state.filter = 'active'; updateFilterButtons(); scheduleRender(); } },
  { id: 'done', label: 'Filter: Done', run: () => { state.filter = 'done'; updateFilterButtons(); scheduleRender(); } },
  { id: 'clear', label: 'Clear completed', run: clearDone },
  { id: 'export', label: 'Export Markdown', run: exportMarkdown },
  { id: 'theme', label: 'Toggle theme', run: () => els.themeBtn.click() },
  { id: 'pomo', label: 'Open Pomodoro', run: openPomodoro },
  { id: 'select', label: 'Toggle select mode', run: () => state.selectMode ? exitSelectMode() : enterSelectMode() },
  { id: 'undo', label: 'Undo last action', hint: 'Ctrl+Z', run: performUndo },
  { id: 'signout', label: 'Sign out', run: signOut }
];
let paletteActive = 0;
let paletteFiltered = [];
function openPalette() {
  els.palette.classList.remove('hidden');
  els.paletteInput.value = '';
  paletteActive = 0;
  renderPalette('');
  setTimeout(() => els.paletteInput.focus(), 20);
}
function closePalette() {
  els.palette.classList.add('hidden');
}
function renderPalette(q) {
  q = q.toLowerCase().trim();
  paletteFiltered = COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q));
  paletteActive = Math.min(paletteActive, paletteFiltered.length - 1);
  els.paletteList.innerHTML = paletteFiltered.map((c, i) =>
    `<li class="palette-item${i === paletteActive ? ' active' : ''}" data-idx="${i}">
       <span>${escapeHtml(c.label)}</span>
       ${c.hint ? `<span class="hint">${escapeHtml(c.hint)}</span>` : ''}
     </li>`).join('');
}
els.paletteList.addEventListener('click', (e) => {
  const li = e.target.closest('.palette-item');
  if (!li) return;
  const cmd = paletteFiltered[+li.dataset.idx];
  if (cmd) { closePalette(); cmd.run(); }
});
function updateFilterButtons() {
  els.filters.forEach(b => b.classList.toggle('active', b.dataset.filter === state.filter));
}

/* ============================================================
   EVENTS
   ============================================================ */
function bindEvents() {
  els.authForm.addEventListener('submit', handleAuthSubmit);
  els.authTabs.forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.mode)));
  els.forgotBtn.addEventListener('click', handleForgot);
  els.githubBtn.addEventListener('click', handleGithub);
  els.signOutBtn.addEventListener('click', signOut);

  els.taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = els.taskInput.value;
    els.taskInput.value = '';
    els.addBtn.disabled = true;
    addTask(value);
    els.taskInput.focus();
  });
  els.taskInput.addEventListener('input', () => {
    els.addBtn.disabled = !els.taskInput.value.trim();
  });
  // multi-line paste
  els.taskInput.addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n')) {
      e.preventDefault();
      text.split('\n').map(s => s.trim()).filter(Boolean).forEach(addTask);
      els.taskInput.value = '';
      els.addBtn.disabled = true;
    }
  });

  els.searchInput.addEventListener('input', debounce(() => {
    state.search = els.searchInput.value;
    scheduleRender();
  }, 150));

  els.filters.forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      updateFilterButtons();
      scheduleRender();
    });
  });

  els.clearDoneBtn.addEventListener('click', clearDone);
  els.selectModeBtn.addEventListener('click', () => state.selectMode ? exitSelectMode() : enterSelectMode());
  els.exportBtn.addEventListener('click', exportMarkdown);
  els.bulkDone.addEventListener('click', bulkMarkDone);
  els.bulkDelete.addEventListener('click', bulkDelete);
  els.bulkCancel.addEventListener('click', exitSelectMode);

  els.helpBtn.addEventListener('click', () => els.helpPanel.classList.remove('hidden'));
  els.helpClose.addEventListener('click', () => els.helpPanel.classList.add('hidden'));
  els.helpPanel.addEventListener('click', (e) => { if (e.target === els.helpPanel) els.helpPanel.classList.add('hidden'); });
  els.palette.addEventListener('click', (e) => { if (e.target === els.palette) closePalette(); });
  els.paletteInput.addEventListener('input', () => { paletteActive = 0; renderPalette(els.paletteInput.value); });

  els.pomoClose.addEventListener('click', () => els.pomo.classList.add('hidden'));
  els.pomoToggle.addEventListener('click', () => {
    state.pomoRunning = !state.pomoRunning;
    els.pomoToggle.textContent = state.pomoRunning ? 'Pause' : 'Start';
    els.pomo.classList.toggle('running', state.pomoRunning);
    if (state.pomoRunning) {
      clearInterval(state.pomoTimer);
      state.pomoTimer = setInterval(tickPomo, 1000);
      notify('Pomodoro started', '25 minutes of focus.');
    } else clearInterval(state.pomoTimer);
  });

  window.addEventListener('online', () => {
    els.offlineBanner.classList.add('hidden');
    flushOfflineQueue();
    showToast('Back online.');
  });
  window.addEventListener('offline', () => {
    els.offlineBanner.classList.remove('hidden');
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA';

    // Ctrl+K palette
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); openPalette(); return;
    }
    // Ctrl+Z undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inInput) {
      e.preventDefault(); performUndo(); return;
    }
    // Ctrl+Enter submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (document.activeElement === els.taskInput) { e.preventDefault(); els.taskForm.requestSubmit(); }
      return;
    }
    if (e.key === 'Escape') {
      if (!els.palette.classList.contains('hidden')) { closePalette(); return; }
      if (!els.helpPanel.classList.contains('hidden')) { els.helpPanel.classList.add('hidden'); return; }
      if (state.editingId) { cancelEdit(); return; }
      if (state.selectMode) { exitSelectMode(); return; }
      if (document.activeElement === els.searchInput) els.searchInput.blur();
    }
    if (inInput) return;

    // shortcuts
    if (e.key === 'n') { e.preventDefault(); els.taskInput.focus(); }
    else if (e.key === '/') { e.preventDefault(); els.searchInput.focus(); }
    else if (e.key === '?') { e.preventDefault(); els.helpPanel.classList.remove('hidden'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = visibleTasks();
      if (!list.length) return;
      e.preventDefault();
      let idx = list.findIndex(t => t.id === state.focusedId);
      if (e.key === 'ArrowDown') idx = (idx + 1) % list.length;
      else idx = (idx - 1 + list.length) % list.length;
      state.focusedId = list[idx].id;
      scheduleRender();
      document.querySelector(`.task-item[data-id="${state.focusedId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    else if (e.key === ' ' && state.focusedId) {
      e.preventDefault(); toggleTask(state.focusedId);
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.focusedId) {
      e.preventDefault(); deleteTask(state.focusedId);
    }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && state.focusedId) {
      e.preventDefault();
      const idx = state.tasks.findIndex(t => t.id === state.focusedId);
      const swap = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= state.tasks.length) return;
      [state.tasks[idx], state.tasks[swap]] = [state.tasks[swap], state.tasks[idx]];
      scheduleRender();
      saveOrder();
    }
  });

  // palette keyboard nav
  els.paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteActive = Math.min(paletteActive + 1, paletteFiltered.length - 1); renderPalette(els.paletteInput.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteActive = Math.max(paletteActive - 1, 0); renderPalette(els.paletteInput.value); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = paletteFiltered[paletteActive];
      if (cmd) { closePalette(); cmd.run(); }
    }
  });

  window.addEventListener('beforeunload', unsubscribeRealtime);
}

/* ============================================================
   PWA (inline service worker)
   ============================================================ */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const sw = `
    self.addEventListener('install', e => self.skipWaiting());
    self.addEventListener('activate', e => self.clients.claim());
    self.addEventListener('fetch', e => {
      if (e.request.method !== 'GET') return;
      e.respondWith(
        caches.open('cloudtodo-v1').then(cache =>
          fetch(e.request).then(res => { cache.put(e.request, res.clone()); return res; })
            .catch(() => cache.match(e.request))
        )
      );
    });
  `;
  try {
    const blob = new Blob([sw], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(blob));
  } catch (e) { console.warn('SW failed', e); }
}

/* ============================================================
   BOOT
   ============================================================ */
let booted = false;
async function boot() {
  if (booted) return;
  booted = true;

  initTheme();
  bindEvents();
  setAuthMode('signin');
  registerSW();
  if (!navigator.onLine) els.offlineBanner.classList.remove('hidden');

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      if (session?.user) enterApp(session.user);
    } else if (event === 'SIGNED_OUT') {
      leaveApp();
    } else if (event === 'PASSWORD_RECOVERY') {
      showAuthInfo('Password recovery mode. Enter a new password and submit.');
      setAuthMode('signin');
    }
  });

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) enterApp(session.user);
    else leaveApp();
  } catch (err) {
    console.error(err);
    leaveApp();
  }
}
boot();
