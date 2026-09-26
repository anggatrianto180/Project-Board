// Unified view over the original records. No migrations, copies or source-column seeding.
(() => {
'use strict';
const ALL_TASK_STATUSES = ['Plan', 'In Progress', 'Waiting', 'Done', 'Close'];
const ALL_TASK_CATEGORIES = ['YouTube', 'TikTok', 'Freelance', 'Design', 'Learning', 'Content', 'Personal', 'Other'];
const SOURCES = { youtube: 'YouTube', tiktok: 'TikTok', personal: 'Personal', working: 'Other', workspace: 'Other' };
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const COLORS = ['#3b82f6', '#facc15', '#a855f7', '#22c55e', '#6b7280'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const options = values => values.map(value => `<option value="${escape(value)}">${escape(value)}</option>`).join('');
const localTaskDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const validTaskDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return '';
    const key = value.slice(0, 10), [year, month, day] = key.split('-').map(Number);
    const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0);
    return localTaskDate(date) === key ? key : '';
};
const taskDateRange = (now = new Date()) => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const sunday = new Date(today); sunday.setDate(today.getDate() + (7 - today.getDay()) % 7);
    return { today: localTaskDate(today), tomorrow: localTaskDate(tomorrow), weekEnd: localTaskDate(sunday) };
};
const canonicalStatus = name => {
    const key = String(name || '').trim().toLowerCase();
    const aliases = { 'to do': 'Plan', todo: 'Plan', backlog: 'Plan', planning: 'Plan', doing: 'In Progress', 'in-progress': 'In Progress', blocked: 'Waiting', completed: 'Done', closed: 'Close', archive: 'Close', archived: 'Close' };
    return ALL_TASK_STATUSES.find(status => status.toLowerCase() === key) || aliases[key];
};
const normalizeWorkspaceTask = (source, task, columns = []) => {
    const column = columns.find(item => item.id === task.columnId);
    // An original-board move wins over a previous unified-only status override.
    const override = task.allTasksColumnId === (task.columnId || '') ? canonicalStatus(task.allTasksStatus) : null;
    const status = source === 'workspace' ? canonicalStatus(task.status) || 'Plan'
        : override || canonicalStatus(column?.name) || canonicalStatus(task.status) || 'Plan';
    const tags = (Array.isArray(task.tags) ? task.tags : Array.isArray(task.labels) ? task.labels : []).filter(tag => typeof tag === 'string');
    const priority = PRIORITIES.find(value => value.toLowerCase() === String(task.priority || '').toLowerCase()) || (tags.includes('urgent') ? 'Urgent' : 'Medium');
    return { ...task, source, key: `${source}/${task.id}`, text: String(task.text || task.title || 'Untitled task'),
        category: ALL_TASK_CATEGORIES.includes(task.category) ? task.category : SOURCES[source] || 'Other',
        dueDate: validTaskDate(task.dueDate),
        priority, tags, status, sourceColumn: column?.name || '', project: String(task.project || '') };
};
const completed = task => ['Done', 'Close'].includes(task.status);
const filterWorkspaceTasks = (tasks, filters, now = new Date()) => {
    const dates = taskDateRange(now);
    const search = String(filters.search || '').trim().toLowerCase();
    return tasks.filter(task => {
        if (search && ![task.text, task.category, task.project, ...task.tags].join(' ').toLowerCase().includes(search)) return false;
        if (filters.category && task.category !== filters.category) return false;
        if (filters.priority && task.priority !== filters.priority) return false;
        if (filters.status && task.status !== filters.status) return false;
        if (filters.due === 'today') return task.dueDate === dates.today;
        if (filters.due === 'tomorrow') return task.dueDate === dates.tomorrow;
        if (filters.due === 'week') return task.dueDate >= dates.today && task.dueDate <= dates.weekEnd;
        if (filters.due === 'overdue') return !!task.dueDate && task.dueDate < dates.today && !completed(task);
        if (filters.due === 'none') return !task.dueDate;
        return true;
    });
};
const workspaceStatusPatch = (task, status, columns) => {
    if (!ALL_TASK_STATUSES.includes(status)) throw new Error('Invalid task status');
    if (task.source === 'workspace') return { status, columnId: status };
    const target = columns.find(column => canonicalStatus(column.name) === status);
    const columnId = target?.id || task.columnId || '';
    // Missing destination stays metadata-only: never restructure a specialized board.
    return { ...(target ? { columnId } : {}), allTasksStatus: status, allTasksColumnId: columnId };
};

function createAllTasksWorkspace({ root, db, collection, doc, onSnapshot, addDoc, updateDoc, isAuthenticated, applyCardTheme, showNotification }) {
    let listeners = [], running = false, generation = 0, timer;
    let data = {}, columns = {}, loading = new Set(), errors = new Set();
    const filters = { search: '', category: '', priority: '', status: '', due: '' };
    const pending = new Set();
    const find = selector => root.querySelector(selector);
    const allTasks = () => Object.keys(SOURCES).flatMap(source => (data[source] || []).map(task => normalizeWorkspaceTask(source, task, columns[source])));
    root.innerHTML = `
        <h2 id="all-tasks-title">All Tasks</h2>
        <p>Manage all your tasks and projects in one place.</p>
        <div class="at-toolbar">
            <label class="at-search">Search tasks<input type="search" id="at-search" placeholder="Search tasks, labels or projects…"></label>
            <button type="button" class="at-button" id="at-filter-toggle" aria-expanded="true" aria-controls="at-filters"><i class="fas fa-filter"></i> Filter &amp; Search</button>
            <button type="button" class="at-button at-primary" id="at-add"><i class="fas fa-plus"></i> Add Task</button>
        </div>
        <div class="at-filters" id="at-filters">
            <label>Category<select id="at-category"><option value="">All categories</option>${options(ALL_TASK_CATEGORIES)}</select></label>
            <label>Priority<select id="at-priority"><option value="">All priorities</option>${options(PRIORITIES)}</select></label>
            <label>Due date<select id="at-due"><option value="">Any date</option><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">This Week</option><option value="overdue">Overdue</option><option value="none">No due date</option></select></label>
            <label>Status<select id="at-status"><option value="">All statuses</option>${options(ALL_TASK_STATUSES)}</select></label>
            <button type="button" class="at-button" id="at-reset">Clear filters</button>
        </div>
        <div id="at-notice" class="at-notice" role="status" aria-live="polite"></div>
        <button type="button" id="at-retry" class="at-button" hidden>Retry loading</button>
        <div id="at-summary" class="at-summary" aria-label="Task summary"></div>
        <div class="at-agendas">
            <section class="at-agenda"><h3>Today's Focus</h3><p>High-priority tasks due today or overdue.</p><div id="at-focus" class="at-agenda-list"></div></section>
            <section class="at-agenda"><h3>Upcoming Tasks</h3><div class="at-upcoming" id="at-upcoming"></div></section>
        </div>
        <p id="at-results"></p>
        <div id="at-board" class="at-board" aria-label="All Tasks Kanban board"></div>`;

    const agendaList = tasks => {
        const list = document.createElement('div'); list.className = 'at-agenda-list';
        if (!tasks.length) list.innerHTML = '<p>No tasks.</p>';
        tasks.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority)).forEach(task => {
            const button = document.createElement('button'); button.className = 'at-agenda-task'; button.type = 'button';
            button.innerHTML = `${escape(task.text)}<small>${escape(task.category)} · ${escape(task.dueDate)} · ${escape(task.priority)}</small>`;
            button.onclick = () => openEditor(task.key); list.appendChild(button);
        });
        return list;
    };
    const changeStatus = async (key, status) => {
        const task = allTasks().find(item => item.key === key);
        if (!task || pending.has(key) || !isAuthenticated()) return;
        pending.add(key); render();
        try {
            const patch = { ...workspaceStatusPatch(task, status, columns[task.source] || []), updatedAt: Date.now() };
            await updateDoc(doc(db, 'hubs', task.source, 'tasks', task.id), patch);
            const original = data[task.source]?.find(item => item.id === task.id);
            if (original) Object.assign(original, patch);
        } catch (error) { showNotification('Could not move task. Please try again.', true); }
        finally { pending.delete(key); render(); }
    };
    const cardFor = task => {
        const card = document.createElement('article'); card.className = 'task-card'; card.dataset.key = task.key;
        card.draggable = !pending.has(task.key); applyCardTheme(card);
        const overdue = task.dueDate && task.dueDate < taskDateRange().today && !completed(task);
        card.innerHTML = `<button type="button" class="task-text">${escape(task.text)}</button>
            <div class="at-badges"><span class="yt-task-tag-pill yt-tag-blue">${escape(task.category)}</span>
            <span class="yt-task-tag-pill ${['High', 'Urgent'].includes(task.priority) ? 'yt-tag-red' : 'yt-tag-purple'}">${escape(task.priority)}</span>
            <span class="yt-task-tag-pill ${overdue ? 'yt-tag-red' : 'yt-tag-green'}">${escape(task.dueDate || 'No due date')}</span>
            ${task.tags.map(tag => `<span class="yt-task-tag-pill yt-tag-blue">${escape(tag)}</span>`).join('')}</div>
            ${task.project ? `<p>Project: ${escape(task.project)}</p>` : ''}
            <p>${escape(task.source === 'workspace' ? 'Workspace' : task.source.charAt(0).toUpperCase() + task.source.slice(1))}${task.sourceColumn ? ` · ${escape(task.sourceColumn)}` : ''}</p>
            <label class="at-task-status">Status<select aria-label="Status for ${escape(task.text)}">${options(ALL_TASK_STATUSES)}</select></label>`;
        card.querySelector('.task-text').onclick = () => openEditor(task.key);
        const select = card.querySelector('select'); select.value = task.status; select.disabled = pending.has(task.key);
        select.onchange = () => changeStatus(task.key, select.value);
        card.ondragstart = event => { event.dataTransfer.setData('application/x-all-tasks', task.key); event.dataTransfer.effectAllowed = 'move'; };
        return card;
    };
    function render() {
        const tasks = allTasks(), visible = filterWorkspaceTasks(tasks, filters), dates = taskDateRange();
        const active = visible.filter(task => !completed(task));
        find('#at-notice').textContent = errors.size ? `Some task sources could not load: ${[...errors].join(', ')}. Showing available tasks.`
            : loading.size ? 'Loading tasks…' : 'Live tasks from YouTube, TikTok, Personal, Working and Workspace. Summary follows filters.';
        find('#at-retry').hidden = !errors.size;
        const stats = { 'Total Tasks': visible.length, 'Due Today': active.filter(task => task.dueDate === dates.today).length,
            Overdue: active.filter(task => task.dueDate && task.dueDate < dates.today).length,
            'In Progress': visible.filter(task => task.status === 'In Progress').length, Completed: visible.filter(completed).length };
        find('#at-summary').innerHTML = Object.entries(stats).map(([label, count]) => `<div class="at-stat"><strong>${count}</strong><span>${label}</span></div>`).join('');
        find('#at-focus').replaceChildren(agendaList(active.filter(task => task.dueDate && task.dueDate <= dates.today && ['High', 'Urgent'].includes(task.priority))));
        find('#at-upcoming').replaceChildren();
        [['Today', task => task.dueDate === dates.today], ['Tomorrow', task => task.dueDate === dates.tomorrow],
            ['This Week', task => task.dueDate > dates.tomorrow && task.dueDate <= dates.weekEnd]].forEach(([label, match]) => {
            const section = document.createElement('section'); section.innerHTML = `<h3>${label}</h3>`;
            section.appendChild(agendaList(active.filter(match))); find('#at-upcoming').appendChild(section);
        });
        find('#at-results').textContent = `${visible.length} of ${tasks.length} tasks${visible.length ? '' : ' — no matching tasks. Add a task or clear filters.'}`;
        const board = find('#at-board'), scroll = board.scrollLeft; board.replaceChildren();
        ALL_TASK_STATUSES.forEach((status, index) => {
            const column = document.createElement('section'); column.className = 'at-column'; column.dataset.status = status;
            column.style.setProperty('--at-accent', COLORS[index]);
            const group = visible.filter(task => task.status === status).sort((a, b) => (a.order || 0) - (b.order || 0) || a.text.localeCompare(b.text));
            column.innerHTML = `<div class="at-column-header"><h3>${status}</h3><span class="yt-task-tag-pill yt-tag-blue">${group.length}</span></div><div class="at-task-list"></div>`;
            const list = column.querySelector('.at-task-list');
            if (!group.length) list.innerHTML = '<p>No tasks.</p>';
            group.forEach(task => list.appendChild(cardFor(task)));
            column.ondragover = event => { if (Array.from(event.dataTransfer.types).includes('application/x-all-tasks')) { event.preventDefault(); column.classList.add('at-drag-over'); } };
            column.ondragleave = () => column.classList.remove('at-drag-over');
            column.ondrop = event => { event.preventDefault(); column.classList.remove('at-drag-over'); changeStatus(event.dataTransfer.getData('application/x-all-tasks'), status); };
            board.appendChild(column);
        });
        board.scrollLeft = scroll;
    }

    function openEditor(key) {
        const task = key ? allTasks().find(item => item.key === key) : null;
        if (key && !task) return;
        document.getElementById('all-tasks-editor')?.remove();
        const dialog = document.createElement('dialog'); dialog.id = 'all-tasks-editor'; dialog.className = 'all-tasks-dialog';
        dialog.setAttribute('aria-labelledby', 'at-editor-title');
        dialog.innerHTML = `<h2 id="at-editor-title">${task ? 'Edit Task' : 'Add Task'}</h2>
            <form><label>Task title<input name="text" required maxlength="500" autocomplete="off"></label>
            <label>Description<textarea name="description" rows="3"></textarea></label>
            <div class="at-form-row"><label>Category<select name="category">${options(ALL_TASK_CATEGORIES)}</select></label>
            <label>Priority<select name="priority">${options(PRIORITIES)}</select></label></div>
            <div class="at-form-row"><label>Due date<input name="dueDate" type="date"></label>
            <label>Status<select name="status">${options(ALL_TASK_STATUSES)}</select></label></div>
            <label>Labels (comma-separated)<input name="tags"></label>
            <label>Project (optional)<input name="project" maxlength="200"></label>
            <small>${task ? 'Updates the original task. Attachments, checklists and other source fields are preserved. A status absent from the original board is kept in All Tasks only.' : 'Creates an independent Workspace task. No YouTube or TikTok account required.'}</small>
            <p class="at-error" role="alert" hidden></p>
            <div class="at-form-actions"><button class="at-button" type="button" data-cancel>Cancel</button><button class="at-button at-primary" type="submit">Save Task</button></div></form>`;
        const form = dialog.querySelector('form');
        const defaults = { text: '', description: '', category: 'Personal', priority: 'Medium', dueDate: '', status: 'Plan', tags: [], project: '' };
        Object.keys(defaults).forEach(name => { form.elements[name].value = name === 'tags' ? (task?.tags || []).join(', ') : task?.[name] ?? defaults[name]; });
        let saving = false;
        const dismiss = () => { dialog.close(); dialog.remove(); };
        const close = () => { if (!saving) dismiss(); };
        dialog.querySelector('[data-cancel]').onclick = close;
        dialog.oncancel = event => { if (saving) event.preventDefault(); };
        dialog.onclick = event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close(); };
        dialog.onclose = () => dialog.remove();
        form.onsubmit = async event => {
            event.preventDefault();
            if (saving || !form.reportValidity()) return;
            const error = dialog.querySelector('.at-error'); error.hidden = true;
            const values = Object.fromEntries(new FormData(form)); values.text = values.text.trim();
            if (!values.text) { error.textContent = 'Please enter a task title.'; error.hidden = false; return; }
            saving = true; form.querySelectorAll('button').forEach(button => button.disabled = true);
            try {
                if (!isAuthenticated()) throw new Error('Please sign in before saving.');
                const latest = task ? allTasks().find(item => item.key === task.key) : null;
                if (task && !latest) throw new Error('This task no longer exists. Close this form and refresh.');
                const patch = { text: values.text, description: values.description.trim(), category: values.category,
                    priority: values.priority, dueDate: values.dueDate || null, tags: [...new Set(values.tags.split(',').map(tag => tag.trim()).filter(Boolean))],
                    project: values.project.trim(), updatedAt: Date.now() };
                if (task) {
                    // Editing metadata does not undo a concurrent source-board move.
                    if (values.status !== task.status) Object.assign(patch, workspaceStatusPatch(latest, values.status, columns[task.source] || []));
                    await updateDoc(doc(db, 'hubs', task.source, 'tasks', task.id), patch);
                } else {
                    await addDoc(collection(db, 'hubs', 'workspace', 'tasks'), { ...patch, status: values.status, columnId: values.status, order: Date.now(), createdAt: Date.now() });
                }
                dismiss(); showNotification(task ? 'Task updated.' : 'Task added.');
            } catch (err) { error.textContent = err.message || 'Could not save task. Please try again.'; error.hidden = false; }
            finally { saving = false; form.querySelectorAll('button').forEach(button => button.disabled = false); }
        };
        document.body.appendChild(dialog); dialog.showModal(); form.elements.text.focus();
    }

    function start() {
        if (running) { render(); return; }
        if (!isAuthenticated()) { find('#at-notice').textContent = 'Sign in to load your tasks.'; return; }
        running = true; const token = ++generation;
        data = {}; columns = {}; errors.clear(); loading.clear();
        const subscriptions = Object.keys(SOURCES).flatMap(source => ['tasks', ...(source === 'workspace' ? [] : ['board_columns'])].map(kind => ({ source, kind, key: `${source}/${kind}` })));
        subscriptions.forEach(({ key }) => loading.add(key)); render();
        subscriptions.forEach(({ source, kind, key }) => {
            const fail = () => { if (generation !== token) return; loading.delete(key); errors.add(key); render(); };
            try {
                listeners.push(onSnapshot(collection(db, 'hubs', source, kind), snapshot => {
                    if (generation !== token) return;
                    const records = snapshot.docs.map(record => ({ ...record.data(), id: record.id }));
                    if (kind === 'tasks') data[source] = records; else columns[source] = records;
                    loading.delete(key); errors.delete(key); render();
                }, fail));
            } catch (err) { fail(); }
        });
        timer = setInterval(render, 60000); // Local-day boundaries stay fresh in an open view.
    }
    function stop() {
        running = false; generation++; listeners.forEach(unsubscribe => unsubscribe()); listeners = [];
        clearInterval(timer); data = {}; columns = {}; loading.clear(); errors.clear();
        document.getElementById('all-tasks-editor')?.remove(); render();
    }
    ['search', 'category', 'priority', 'due', 'status'].forEach(name => {
        find(`#at-${name}`).addEventListener(name === 'search' ? 'input' : 'change', event => { filters[name] = event.target.value; render(); });
    });
    find('#at-reset').onclick = () => { Object.keys(filters).forEach(name => { filters[name] = ''; find(`#at-${name}`).value = ''; }); render(); };
    find('#at-filter-toggle').onclick = () => { const panel = find('#at-filters'); panel.hidden = !panel.hidden; find('#at-filter-toggle').setAttribute('aria-expanded', String(!panel.hidden)); };
    find('#at-add').onclick = () => openEditor();
    find('#at-retry').onclick = () => { stop(); start(); };
    new MutationObserver(() => { if (running) render(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    render();
    return { start, stop };
}
// A classic script supports double-click/file:// usage without module CORS restrictions.
window.AllTasks = Object.freeze({ createAllTasksWorkspace, ALL_TASK_STATUSES, ALL_TASK_CATEGORIES,
    localTaskDate, taskDateRange, normalizeWorkspaceTask, filterWorkspaceTasks, workspaceStatusPatch });
})();