import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* ============================================================
   CONFIG - fill these in after creating your Supabase project
   ============================================================ */
const SUPABASE_URL  = 'https://mrdjzcaiqrkygxkgoajh.supabase.co';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yZGp6Y2FpcXJreWd4a2dvYWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMzMwODQsImV4cCI6MjEwNjkwOTA4NH0.ftXZtwLGYMge2MtejHYfKyQ_AURvYlQ2G1rnuqGgOhY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================================
   STATE
   ============================================================ */
const state = {
    user: null,
    tasks: [],
    filter: 'all',
    authMode: 'signin',
    realtimeChannel: null
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
    taskList: $('taskList'),
    emptyState: $('emptyState'),
    statsText: $('statsText'),
    filters: document.querySelectorAll('.filter'),
    syncStatus: $('syncStatus'),
    syncText: $('syncText')
};

/* ============================================================
   UI HELPERS
   ============================================================ */
function setSync(status, text) {
    els.syncStatus.classList.remove('syncing', 'error');
    if (status === 'syncing') els.syncStatus.classList.add('syncing');
    if (status === 'error')   els.syncStatus.classList.add('error');
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

function setAuthMode(mode) {
    state.authMode = mode;
    els.authTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    els.authSubmit.textContent = mode === 'signin' ? 'Sign in' : 'Create account';
    els.authPassword.setAttribute('autocomplete', mode === 'signin' ? 'current-password' : 'new-password');
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

    els.authSubmit.disabled = true;
    els.authSubmit.textContent = state.authMode === 'signin' ? 'Signing in...' : 'Creating account...';

    try {
        if (state.authMode === 'signin') {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
        } else {
            const { error } = await supabase.auth.signUp({ email, password });
            if (error) throw error;
            showAuthInfo('Account created. You are now signed in.');
        }
    } catch (err) {
        showAuthError(err.message || 'Something went wrong.');
    } finally {
        els.authSubmit.disabled = false;
        els.authSubmit.textContent = state.authMode === 'signin' ? 'Sign in' : 'Create account';
    }
}

async function signOut() {
    await supabase.auth.signOut();
}

function enterApp(user) {
    state.user = user;
    els.authScreen.classList.add('hidden');
    els.todoScreen.classList.remove('hidden');
    els.userEmail.classList.remove('hidden');
    els.userEmail.textContent = user.email;
    els.signOutBtn.classList.remove('hidden');
    els.taskInput.focus();
    loadTasks();
    subscribeRealtime();
}

function leaveApp() {
    state.user = null;
    state.tasks = [];
    els.authScreen.classList.remove('hidden');
    els.todoScreen.classList.add('hidden');
    els.userEmail.classList.add('hidden');
    els.signOutBtn.classList.add('hidden');
    els.authEmail.value = '';
    els.authPassword.value = '';
    unsubscribeRealtime();
}

/* ============================================================
   TASKS
   ============================================================ */
async function loadTasks() {
    setSync('syncing', 'Loading...');
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .order('position', { ascending: true });
        if (error) throw error;
        state.tasks = data || [];
        renderTasks();
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        setSync('error', 'Failed to load');
    }
}

async function addTask(text) {
    const clean = String(text).trim();
    if (!clean) return;

    const position = state.tasks.length
        ? Math.max(...state.tasks.map(t => t.position)) + 1
        : 0;

    const optimistic = {
        id: 'temp-' + Date.now(),
        user_id: state.user.id,
        text: clean,
        done: false,
        position,
        created_at: new Date().toISOString()
    };

    state.tasks.push(optimistic);
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { data, error } = await supabase
            .from('tasks')
            .insert({
                user_id: state.user.id,
                text: clean,
                done: false,
                position
            })
            .select()
            .single();
        if (error) throw error;

        const idx = state.tasks.findIndex(t => t.id === optimistic.id);
        if (idx !== -1) state.tasks[idx] = data;
        renderTasks();
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        state.tasks = state.tasks.filter(t => t.id !== optimistic.id);
        renderTasks();
        setSync('error', 'Save failed');
    }
}

async function toggleTask(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    const newDone = !task.done;
    task.done = newDone;
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { error } = await supabase
            .from('tasks')
            .update({ done: newDone })
            .eq('id', id);
        if (error) throw error;
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        task.done = !newDone;
        renderTasks();
        setSync('error', 'Save failed');
    }
}

async function deleteTask(id) {
    const backup = state.tasks.slice();
    state.tasks = state.tasks.filter(t => t.id !== id);
    renderTasks();
    setSync('syncing', 'Saving...');

    try {
        const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', id);
        if (error) throw error;
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        state.tasks = backup;
        renderTasks();
        setSync('error', 'Delete failed');
    }
}

async function saveOrder() {
    setSync('syncing', 'Saving order...');
    try {
        const updates = state.tasks.map((t, i) => ({
            id: t.id,
            user_id: state.user.id,
            text: t.text,
            done: t.done,
            position: i
        }));
        const { error } = await supabase
            .from('tasks')
            .upsert(updates, { onConflict: 'id' });
        if (error) throw error;
        state.tasks.forEach((t, i) => t.position = i);
        setSync('ok', 'Synced');
    } catch (err) {
        console.error(err);
        setSync('error', 'Order save failed');
    }
}

/* ============================================================
   RENDER
   ============================================================ */
function visibleTasks() {
    if (state.filter === 'active') return state.tasks.filter(t => !t.done);
    if (state.filter === 'done')   return state.tasks.filter(t => t.done);
    return state.tasks;
}

function renderTasks() {
    const list = visibleTasks();

    els.taskList.innerHTML = '';

    if (list.length === 0) {
        els.emptyState.classList.remove('hidden');
        if (state.tasks.length === 0) {
            els.emptyState.textContent = 'No tasks yet. Add one above.';
        } else if (state.filter === 'done') {
            els.emptyState.textContent = 'No completed tasks yet.';
        } else if (state.filter === 'active') {
            els.emptyState.textContent = 'No active tasks. Nice work.';
        } else {
            els.emptyState.textContent = 'No tasks to show.';
        }
    } else {
        els.emptyState.classList.add('hidden');
    }

    list.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item' + (task.done ? ' done' : '');
        li.draggable = state.filter === 'all';
        li.dataset.id = task.id;

        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'task-check' + (task.done ? ' done' : '');
        check.setAttribute('aria-label', task.done ? 'Mark as not done' : 'Mark as done');
        check.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        check.addEventListener('click', () => toggleTask(task.id));

        const body = document.createElement('div');
        body.className = 'task-body';
        const text = document.createElement('div');
        text.className = 'task-text';
        text.textContent = task.text;
        body.appendChild(text);

        const actions = document.createElement('div');
        actions.className = 'task-actions';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'task-icon-btn danger';
        delBtn.title = 'Delete';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
        delBtn.addEventListener('click', () => deleteTask(task.id));

        actions.appendChild(delBtn);

        li.appendChild(check);
        li.appendChild(body);
        li.appendChild(actions);

        if (li.draggable) {
            li.addEventListener('dragstart', onDragStart);
            li.addEventListener('dragover', onDragOver);
            li.addEventListener('dragleave', onDragLeave);
            li.addEventListener('drop', onDrop);
            li.addEventListener('dragend', onDragEnd);
        }

        els.taskList.appendChild(li);
    });

    const active = state.tasks.filter(t => !t.done).length;
    els.statsText.textContent = active + ' active';
}

/* ============================================================
   DRAG AND DROP
   ============================================================ */
let draggedId = null;

function onDragStart(e) {
    draggedId = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
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
    const targetId = e.currentTarget.dataset.id;
    e.currentTarget.classList.remove('drag-over');
    if (!draggedId || draggedId === targetId) return;

    const draggedIdx = state.tasks.findIndex(t => t.id === draggedId);
    const targetIdx = state.tasks.findIndex(t => t.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [moved] = state.tasks.splice(draggedIdx, 1);
    state.tasks.splice(targetIdx, 0, moved);

    renderTasks();
    saveOrder();
}

function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    draggedId = null;
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

/* ============================================================
   REALTIME
   ============================================================ */
function subscribeRealtime() {
    if (state.realtimeChannel) return;

    state.realtimeChannel = supabase
        .channel('tasks-changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${state.user.id}` },
            payload => {
                if (payload.eventType === 'INSERT') {
                    if (!state.tasks.find(t => t.id === payload.new.id)) {
                        state.tasks.push(payload.new);
                        state.tasks.sort((a, b) => (a.position || 0) - (b.position || 0));
                        renderTasks();
                    }
                } else if (payload.eventType === 'UPDATE') {
                    const idx = state.tasks.findIndex(t => t.id === payload.new.id);
                    if (idx !== -1) {
                        state.tasks[idx] = payload.new;
                        renderTasks();
                    }
                } else if (payload.eventType === 'DELETE') {
                    state.tasks = state.tasks.filter(t => t.id !== payload.old.id);
                    renderTasks();
                }
            })
        .subscribe();
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

    els.taskForm.addEventListener('submit', e => {
        e.preventDefault();
        addTask(els.taskInput.value);
        els.taskInput.value = '';
        els.taskInput.focus();
    });

    els.filters.forEach(btn => {
        btn.addEventListener('click', () => {
            state.filter = btn.dataset.filter;
            els.filters.forEach(b => b.classList.toggle('active', b === btn));
            renderTasks();
        });
    });
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot() {
    bindEvents();
    setAuthMode('signin');

    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) {
        enterApp(session.user);
    } else {
        leaveApp();
    }

    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session && session.user) {
            enterApp(session.user);
        } else if (event === 'SIGNED_OUT') {
            leaveApp();
        }
    });
}

boot();
