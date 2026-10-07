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
    toastTimer: null
};

/* ============================================================
   DOM
   ============================================================ */
const $ = (id) => document.getElementById(id);

const els = {
    authScreen: $('authScreen'),
    todoScreen: $('todoScreen'),
    authForm: $('authForm'),
    authEmail: $('authEmail'),
    authPassword: $('authPassword'),
    authSubmit: $('authSubmit'),
    authError: $('authError'),
    authInfo: $('authInfo'),
    authTabs: document.querySelectorAll('.auth-tab'),

    userEmail: $('userEmail'),
    signOutBtn: $('signOutBtn'),

    taskForm: $('taskForm'),
    taskInput: $('taskInput'),
    searchInput: $('searchInput'),
    taskList: $('taskList'),
    emptyState: $('emptyState'),
    statsText: $('statsText'),
    clearDoneBtn: $('clearDoneBtn'),
    filters: document.querySelectorAll('.filter'),
    syncStatus: $('syncStatus'),
    syncText: $('syncText'),
    toast: $('toast')
};

/* ============================================================
   UI HELPERS
   ============================================================ */
function setSync(status, text) {
    els.syncStatus.classList.remove('syncing', 'error');
    if (status === 'syncing') els.syncStatus.classList.add('syncing');
    if (status === 'error') els.syncStatus.classList.add('error');
    els.syncText.textContent = text;
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

function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
        els.toast.classList.add('hidden');
    }, 2400);
}

function setAuthMode(mode) {
    state.authMode = mode;
    els.authTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    els.authSubmit.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    els.authPassword.setAttribute(
        'autocomplete',
        mode === 'signin' ? 'current-password' : 'new-password'
    );
    clearAuthMessages();
}

/* ============================================================
   AUTH
   ============================================================ */
async function handleAuthSubmit(e) {
    e.preventDefault();
    clearAuthMessages();

    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;

    if (!email || !password) {
        showAuthError('Email and password are required.');
        return;
    }
    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters.');
        return;
    }

    els.authSubmit.disabled = true;
    els.authSubmit.textContent = state.authMode === 'signin' ? 'Signing in...' : 'Creating account...';

    try {
        if (state.authMode === 'signin') {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
        } else {
            const { data, error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;

            if (data.session) {
                showAuthInfo('Account created. You are now signed in.');
            } else {
                showAuthInfo('Account created. Check your email to confirm, then sign in.');
                setAuthMode('signin');
            }
        }
    } catch (err) {
        showAuthError(err.message || 'Something went wrong.');
    } finally {
        els.authSubmit.disabled = false;
        els.authSubmit.textContent = state.authMode === 'signin' ? 'Sign in' : 'Create account';
    }
}

async function signOut() {
    try {
        await supabase.auth.signOut();
    } catch (err) {
        console.error(err);
        showToast('Sign out failed. Try again.');
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

    loadTasks().finally(() => {
        subscribeRealtime();
        state.entering = false;
    });
}

function leaveApp() {
    state.user = null;
    state.tasks = [];
    state.filter = 'all';
    state.search = '';
    state.editingId = null;
    state.pendingIds.clear();

    els.searchInput.value = '';
    els.filters.forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));

    els.authScreen.classList.remove('hidden');
    els.todoScreen.classList.add('hidden');
    els.userEmail.classList.add('hidden');
    els.signOutBtn.classList.add('hidden');
    els.authEmail.value = '';
    els.authPassword.value = '';

    setAuthMode('signin');
    unsubscribeRealtime();
    setSync('ok', 'Ready');
}

/* ============================================================
   TASKS
   ============================================================ */
async function loadTasks() {
    if (!state.user) return;

    setSync('syncing', 'Loading...');
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', state.user.id)
            .order('position', { ascending: true })
            .order('created_at', { ascending: true })
            .limit(1000);

        if (error) throw error;

        state.tasks = (data || []).map(normalizeTask);
        renderTasks();
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        setSync('error', 'Failed to load');
        showToast('Could not load tasks.');
    }
}

function normalizeTask(t) {
    return {
        id: t.id,
        user_id: t.user_id,
        text: t.text,
        done: !!t.done,
        position: Number.isFinite(t.position) ? t.position : 0,
        created_at: t.created_at || new Date().toISOString()
    };
}

function nextPosition() {
    if (!state.tasks.length) return 0;
    return Math.max(...state.tasks.map(t => t.position || 0)) + 1;
}

async function addTask(text) {
    const clean = String(text).trim();
    if (!clean || !state.user) return;

    const id = crypto.randomUUID();
    const optimistic = {
        id,
        user_id: state.user.id,
        text: clean,
        done: false,
        position: nextPosition(),
        created_at: new Date().toISOString()
    };

    state.pendingIds.add(id);
    state.tasks.push(optimistic);
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { data, error } = await supabase
            .from('tasks')
            .insert({
                id,
                user_id: state.user.id,
                text: clean,
                done: false,
                position: optimistic.position
            })
            .select()
            .single();

        if (error) throw error;

        const idx = state.tasks.findIndex(t => t.id === id);
        if (idx !== -1) state.tasks[idx] = normalizeTask(data);
        renderTasks();
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        state.tasks = state.tasks.filter(t => t.id !== id);
        renderTasks();
        setSync('error', 'Save failed');
        showToast('Could not add task.');
    } finally {
        state.pendingIds.delete(id);
    }
}

async function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task || state.pendingIds.has(id)) return;

    const newDone = !task.done;
    const previous = task.done;
    task.done = newDone;
    state.pendingIds.add(id);
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { error } = await supabase
            .from('tasks')
            .update({ done: newDone })
            .eq('id', id)
            .eq('user_id', state.user.id);

        if (error) throw error;
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        task.done = previous;
        renderTasks();
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

    const previous = task.text;
    task.text = clean;
    state.pendingIds.add(id);
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { error } = await supabase
            .from('tasks')
            .update({ text: clean })
            .eq('id', id)
            .eq('user_id', state.user.id);

        if (error) throw error;
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        task.text = previous;
        renderTasks();
        setSync('error', 'Save failed');
        showToast('Could not rename task.');
    } finally {
        state.pendingIds.delete(id);
    }
}

async function deleteTask(id) {
    const backup = state.tasks.slice();
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.pendingIds.add(id);
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', id)
            .eq('user_id', state.user.id);

        if (error) throw error;
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        state.tasks = backup;
        renderTasks();
        setSync('error', 'Delete failed');
        showToast('Could not delete task.');
    } finally {
        state.pendingIds.delete(id);
    }
}

async function clearDone() {
    const done = state.tasks.filter(t => t.done);
    if (!done.length) return;

    const backup = state.tasks.slice();
    const ids = done.map(t => t.id);
    state.tasks = state.tasks.filter(t => !t.done);
    ids.forEach(id => state.pendingIds.add(id));
    renderTasks();
    setSync('syncing', 'Clearing...');

    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .in('id', ids)
            .eq('user_id', state.user.id);

        if (error) throw error;
        setSync('ok', 'Synced');
        showToast(`Cleared ${ids.length} task${ids.length === 1 ? '' : 's'}.`);
    } catch (err) {
        console.error(err);
        state.tasks = backup;
        renderTasks();
        setSync('error', 'Clear failed');
        showToast('Could not clear done tasks.');
    } finally {
        ids.forEach(id => state.pendingIds.delete(id));
    }
}

async function saveOrder() {
    if (!state.user) return;

    setSync('syncing', 'Saving order...');
    state.suppressRealtime = true;

    try {
        const results = await Promise.all(
            state.tasks.map((t, i) =>
                supabase
                    .from('tasks')
                    .update({ position: i })
                    .eq('id', t.id)
                    .eq('user_id', state.user.id)
            )
        );

        const firstError = results.find(r => r.error);
        if (firstError) throw firstError.error;

        state.tasks.forEach((t, i) => { t.position = i; });
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        setSync('error', 'Order save failed');
        showToast('Could not save order.');
    } finally {
        setTimeout(() => { state.suppressRealtime = false; }, 400);
    }
}

/* ============================================================
   RENDER
   ============================================================ */
function visibleTasks() {
    const q = state.search.trim().toLowerCase();
    let list = state.tasks;

    if (state.filter === 'active') list = list.filter(t => !t.done);
    else if (state.filter === 'done') list = list.filter(t => t.done);

    if (q) list = list.filter(t => t.text.toLowerCase().includes(q));

    return list;
}

function updateEmptyState(list) {
    const hasAny = state.tasks.length > 0;
    const q = state.search.trim();

    if (list.length > 0) {
        els.emptyState.classList.add('hidden');
        return;
    }

    els.emptyState.classList.remove('hidden');

    if (!hasAny) {
        els.emptyState.textContent = 'No tasks yet. Add one above to get started.';
    } else if (q) {
        els.emptyState.textContent = `No tasks match "${q}".`;
    } else if (state.filter === 'done') {
        els.emptyState.textContent = 'No completed tasks yet.';
    } else if (state.filter === 'active') {
        els.emptyState.textContent = 'No active tasks. Nice work.';
    } else {
        els.emptyState.textContent = 'Nothing to show.';
    }
}

function renderTasks() {
    const list = visibleTasks();
    els.taskList.innerHTML = '';

    updateEmptyState(list);

    list.forEach(task => {
        els.taskList.appendChild(buildTaskItem(task));
    });

    const active = state.tasks.filter(t => !t.done).length;
    els.statsText.textContent = `${active} active / ${state.tasks.length} total`;
    els.clearDoneBtn.classList.toggle('hidden', !state.tasks.some(t => t.done));
}

function buildTaskItem(task) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '');
    li.dataset.id = task.id;

    const draggable = state.filter === 'all' && !state.search.trim() && !state.editingId;
    li.draggable = draggable;

    /* checkbox */
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'task-check' + (task.done ? ' done' : '');
    check.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
    check.textContent = task.done ? '✓' : '';
    check.addEventListener('click', () => toggleTask(task.id));

    /* body */
    const body = document.createElement('div');
    body.className = 'task-body';

    if (state.editingId === task.id) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'task-edit-input';
        input.value = task.text;
        input.maxLength = 200;

        const commit = () => {
            const val = input.value;
            state.editingId = null;
            if (val.trim() && val.trim() !== task.text) {
                updateTaskText(task.id, val);
            } else {
                renderTasks();
            }
        };

        const cancel = () => {
            state.editingId = null;
            renderTasks();
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit);

        body.appendChild(input);
        queueMicrotask(() => {
            input.focus();
            input.select();
        });
    } else {
        const text = document.createElement('div');
        text.className = 'task-text';
        text.textContent = task.text;
        text.title = 'Double-click to edit';
        text.addEventListener('dblclick', () => {
            state.editingId = task.id;
            renderTasks();
        });
        body.appendChild(text);
    }

    /* actions */
    const actions = document.createElement('div');
    actions.className = 'task-actions';

    if (state.editingId !== task.id) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'task-icon-btn';
        editBtn.title = 'Edit';
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', () => {
            state.editingId = task.id;
            renderTasks();
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'task-icon-btn danger';
        delBtn.title = 'Delete';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => deleteTask(task.id));

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
    }

    li.appendChild(check);
    li.appendChild(body);
    li.appendChild(actions);

    if (draggable) {
        li.addEventListener('dragstart', onDragStart);
        li.addEventListener('dragover', onDragOver);
        li.addEventListener('dragleave', onDragLeave);
        li.addEventListener('drop', onDrop);
        li.addEventListener('dragend', onDragEnd);
    }

    return li;
}

/* ============================================================
   DRAG AND DROP
   ============================================================ */
let draggedId = null;

function onDragStart(e) {
    draggedId = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', draggedId); } catch (_) {}
}

function onDragOver(e) {
    e.preventDefault();
    const li = e.currentTarget;
    if (li.dataset.id === draggedId) return;
    li.classList.add('drag-over');
}

function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
    e.preventDefault();
    const targetLi = e.currentTarget;
    const targetId = targetLi.dataset.id;
    targetLi.classList.remove('drag-over');

    if (!draggedId || draggedId === targetId) {
        draggedId = null;
        return;
    }

    const draggedIdx = state.tasks.findIndex(t => t.id === draggedId);
    const targetIdx = state.tasks.findIndex(t => t.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) {
        draggedId = null;
        return;
    }

    const rect = targetLi.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;

    const [moved] = state.tasks.splice(draggedIdx, 1);
    let insertIdx = targetIdx;
    if (draggedIdx < targetIdx) insertIdx -= 1;
    if (after) insertIdx += 1;

    state.tasks.splice(insertIdx, 0, moved);

    draggedId = null;
    renderTasks();
    saveOrder();
}

function onDragEnd(e) {
    if (e && e.currentTarget) e.currentTarget.classList.remove('dragging');
    draggedId = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

/* ============================================================
   REALTIME
   ============================================================ */
function subscribeRealtime() {
    if (!state.user) return;
    if (state.realtimeChannel) return;

    state.realtimeChannel = supabase
        .channel('tasks-' + state.user.id)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'tasks',
                filter: `user_id=eq.${state.user.id}`
            },
            (payload) => {
                if (state.suppressRealtime) return;

                if (payload.eventType === 'INSERT') {
                    const incoming = normalizeTask(payload.new);
                    if (state.pendingIds.has(incoming.id)) return;
                    const idx = state.tasks.findIndex(t => t.id === incoming.id);
                    if (idx === -1) {
                        state.tasks.push(incoming);
                        state.tasks.sort((a, b) =>
                            (a.position || 0) - (b.position || 0) ||
                            String(a.created_at).localeCompare(String(b.created_at))
                        );
                        renderTasks();
                    }
                } else if (payload.eventType === 'UPDATE') {
                    const incoming = normalizeTask(payload.new);
                    if (state.pendingIds.has(incoming.id)) return;
                    const idx = state.tasks.findIndex(t => t.id === incoming.id);
                    if (idx !== -1) {
                        state.tasks[idx] = incoming;
                        renderTasks();
                    }
                } else if (payload.eventType === 'DELETE') {
                    const removedId = payload.old?.id;
                    if (!removedId) return;
                    if (state.pendingIds.has(removedId)) return;
                    state.tasks = state.tasks.filter(t => t.id !== removedId);
                    renderTasks();
                }
            }
        )
        .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                setSync('error', 'Realtime offline');
            }
        });
}

function unsubscribeRealtime() {
    if (state.realtimeChannel) {
        supabase.removeChannel(state.realtimeChannel);
        state.realtimeChannel = null;
    }
}

/* ============================================================
   EVENTS
   ============================================================ */
function bindEvents() {
    els.authForm.addEventListener('submit', handleAuthSubmit);

    els.authTabs.forEach(tab => {
        tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
    });

    els.signOutBtn.addEventListener('click', signOut);

    els.taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = els.taskInput.value;
        els.taskInput.value = '';
        addTask(value);
        els.taskInput.focus();
    });

    els.searchInput.addEventListener('input', () => {
        state.search = els.searchInput.value;
        renderTasks();
    });

    els.filters.forEach(btn => {
        btn.addEventListener('click', () => {
            state.filter = btn.dataset.filter;
            els.filters.forEach(b => b.classList.toggle('active', b === btn));
            renderTasks();
        });
    });

    els.clearDoneBtn.addEventListener('click', clearDone);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && state.editingId) {
            state.editingId = null;
            renderTasks();
        }
        if (e.key === '/' && document.activeElement !== els.taskInput &&
            document.activeElement !== els.searchInput &&
            document.activeElement?.tagName !== 'INPUT') {
            e.preventDefault();
            if (state.user) els.searchInput.focus();
        }
    });

    window.addEventListener('beforeunload', unsubscribeRealtime);
}

/* ============================================================
   BOOT
   ============================================================ */
let booted = false;

async function boot() {
    if (booted) return;
    booted = true;

    bindEvents();
    setAuthMode('signin');

    // Register listener first to avoid missing events
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (session?.user) enterApp(session.user);
        } else if (event === 'SIGNED_OUT') {
            leaveApp();
        }
    });

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            enterApp(session.user);
        } else {
            leaveApp();
        }
    } catch (err) {
        console.error(err);
        leaveApp();
    }
}

boot();
