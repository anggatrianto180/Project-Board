// Run with Node and installed Chrome/Edge. All Firestore activity is mocked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const moduleSource = fs.readFileSync(path.join(__dirname, 'all-tasks.js'), 'utf8');
new vm.Script(moduleSource);
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/src=|application\/ld\+json/.test(script[1])) continue;
    new vm.Script(script[2].replace(/^\s*import\s.*?;\s*$/gm, ''));
}
function slice(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error('Missing integration marker: ' + start);
    return html.slice(a, b);
}
const nav = slice('        const sections =', '        // On initial load, apply navigation');
const theme = slice('        const isDark = () =>', '        // ---- Open Edit Task Modal ----');
const integration = slice('        // Optional workspace:', '        const MENU_SETTINGS_KEY =');
if (/import\s+\{\s*createAllTasksWorkspace\s*\}\s+from/.test(html)) {
    throw new Error('All Tasks must not be a static dependency of the main application.');
}
if (/\bimport\s*\(/.test(integration)) throw new Error('All Tasks must support file:// without dynamic module imports.');
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1]).join('\n');
const browser = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(file => file && fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH to an installed Chrome/Edge executable.');

const setup = `
const db = {}, auth = { currentUser: { uid: 'test-user' } };
let currentMode = 'personal', failWrite = false, nextId = 0, subscribed = 0, unsubscribed = 0;
const notifications = [], writes = [], subscriptions = new Map();
const showNotification = (...args) => notifications.push(args);
const updateModeUI = () => {};
const initYtBoard = () => {}, initYtBoardSettings = () => {};
const initTtBoard = () => {}, initTtBoardSettings = () => {};
const normalizeTradeColors = () => {};
const dates = taskDateRange();
const previous = new Date(); previous.setDate(previous.getDate() - 1);
const commonColumns = [{id:'plan', name:'Plan'}, {id:'progress', name:'In Progress'}, {id:'done', name:'Done'}];
const store = {};
for (const source of ['youtube', 'tiktok', 'personal', 'working']) store['hubs/' + source + '/board_columns'] = structuredClone(commonColumns);
store['hubs/youtube/tasks'] = [{ id:'same', text:'Create YouTube Orchestra Thumbnail', columnId:'plan', dueDate:dates.today, priority:'High', tags:['design'], checklist:[{text:'Keep',done:false}], driveLink:'https://example.com/file' }];
store['hubs/tiktok/tasks'] = [{ id:'same', text:'Upload TikTok Affiliate Video', columnId:'progress', dueDate:dates.tomorrow }];
store['hubs/personal/tasks'] = [{ id:'personal', text:'Personal Task', columnId:'plan' }];
store['hubs/working/tasks'] = [{ id:'fiverr', text:'Complete Fiverr Client Order', category:'Freelance', columnId:'plan', dueDate:localTaskDate(previous), priority:'Urgent', project:'Client order' }];
store['hubs/workspace/tasks'] = [
    {id:'learn', text:'Study Playwright', category:'Learning', status:'Plan', dueDate:dates.today, priority:'High'},
    {id:'design', text:'Create Vecteezy Designs', category:'Design', status:'Waiting'},
    {id:'content', text:'Research AI Video Ideas', category:'Content', status:'Done', dueDate:localTaskDate(previous)},
    {id:'closed', text:'Closed task', category:'Other', status:'Close'}
];
const collection = (_, ...parts) => parts.join('/');
const doc = collection;
const snapshot = key => ({docs:(store[key] || []).map(item => ({id:item.id, data:() => {const copy = structuredClone(item); delete copy.id; return copy;}}))});
const emit = key => subscriptions.get(key)?.next(snapshot(key));
const onSnapshot = (key, next, error) => {
    subscribed++; subscriptions.set(key, { next, error }); next(snapshot(key));
    return () => { unsubscribed++; subscriptions.delete(key); };
};
const updateDoc = async (ref, patch) => {
    if (failWrite) throw new Error('Simulated write failure');
    writes.push({ref, patch}); const parts = ref.split('/'), id = parts.pop(), key = parts.join('/');
    Object.assign(store[key].find(item => item.id === id), patch); emit(key);
};
const addDoc = async (ref, patch) => {
    if (failWrite) throw new Error('Simulated write failure');
    writes.push({ref, patch}); const id = 'new-' + (++nextId); store[ref].push({id, ...patch}); emit(ref); return {id};
};
`;
const tests = `
(async () => {
    let assertions = 0;
    const assert = (condition, message) => { if (!condition) throw new Error(message); assertions++; };
    const el = id => document.getElementById(id);
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    const cards = () => [...el('at-board').querySelectorAll('.task-card')];
    const card = key => cards().find(node => node.dataset.key === key);
    const filter = (name, value) => { const input = el('at-' + name); input.value = value; input.dispatchEvent(new Event(name === 'search' ? 'input' : 'change')); };
    const reset = () => el('at-reset').click();
    const submit = async () => { const form = el('all-tasks-editor').querySelector('form'); await form.onsubmit({preventDefault(){}}); await tick(); };
    const status = async (key, value) => { const select = card(key).querySelector('select'); select.value = value; await select.onchange(); };
    try {
        assert(taskDateRange(new Date(2026,11,31)).tomorrow === '2027-01-01', 'tomorrow crosses year');
        assert(taskDateRange(new Date(2026,11,31)).weekEnd === '2027-01-03', 'week crosses year');
        assert(taskDateRange(new Date(2026,8,27)).weekEnd === '2026-09-27', 'Sunday is final day of week');
        assert(taskDateRange(new Date(2024,1,28)).tomorrow === '2024-02-29', 'local leap year');
        assert(normalizeWorkspaceTask('workspace', {id:'bad-date', dueDate:'2026-02-30'}).dueDate === '', 'invalid source date excluded');
        assert(normalizeWorkspaceTask('workspace', {id:'iso-date', dueDate:'2026-09-26T00:00:00Z'}).dueDate === '2026-09-26', 'ISO due date keeps calendar day');
        const legacy = normalizeWorkspaceTask('personal', {id:'x',text:'Old',columnId:'custom'}, [{id:'custom',name:'Ideas'}]);
        assert(legacy.status === 'Plan' && legacy.sourceColumn === 'Ideas', 'unmapped custom columns remain visible');
        assert(normalizeWorkspaceTask('youtube', {id:'x',columnId:'x'}, [{id:'x',name:'Closed'}]).status === 'Close', 'closed alias');
        assert(subscribed === 0, 'no subscriptions before menu opens');
        el('all-tasks-btn').click(); await tick(); await window.startAllTasks();
        assert(location.hash === '#/all-tasks' && !el('all-tasks-section').classList.contains('hidden'), 'desktop navigation');
        assert(el('youtube-section').classList.contains('hidden') && el('tiktok-section').classList.contains('hidden'), 'specialized pages hidden only');
        assert(el('all-tasks-btn').getAttribute('aria-pressed') === 'true', 'active navigation state');
        assert(subscribed === 9 && writes.length === 0, 'read-only initialization with all five task sources');
        window.startAllTasks(); assert(subscribed === 9, 'no duplicate listeners');
        assert(cards().length === 8 && new Set(cards().map(node => node.dataset.key)).size === 8, 'all tasks, no cross-source ID collision');
        assert(el('at-board').querySelectorAll('.at-column').length === 5, 'five Kanban columns');
        assert(el('at-summary').querySelector('strong').textContent === '8', 'total task summary');
        assert([...el('at-summary').querySelectorAll('strong')].at(-1).textContent === '2', 'Done and Close completed');
        assert(el('at-focus').textContent.includes('Study Playwright') && el('at-focus').textContent.includes('Fiverr'), 'focus includes high priority today and overdue');
        assert(!el('at-focus').textContent.includes('Closed task'), 'focus excludes closed tasks');
        assert(el('at-upcoming').children[1].textContent.includes('TikTok'), 'tomorrow tasks');
        assert(!el('at-upcoming').children[2].textContent.includes('TikTok') && !el('at-upcoming').children[2].textContent.includes('Study Playwright'), 'upcoming groups do not duplicate today or tomorrow');
        assert(getComputedStyle(card('youtube/same')).flexDirection === 'column', 'card fields stack vertically');
        filter('category', 'YouTube'); assert(cards().length === 1 && card('youtube/same'), 'category filter');
        filter('priority', 'Low'); assert(cards().length === 0 && el('at-results').textContent.includes('no matching'), 'combined filters and empty state'); reset();
        filter('priority', 'Urgent'); assert(cards().length === 1 && card('working/fiverr'), 'priority filter'); reset();
        filter('due', 'overdue'); assert(cards().length === 1 && card('working/fiverr'), 'overdue excludes completed'); reset();
        filter('due', 'today'); assert(cards().length === 2, 'today filter'); reset();
        filter('due', 'tomorrow'); assert(cards().length === 1, 'tomorrow filter'); reset();
        filter('due', 'none'); assert(cards().length === 3, 'no due date filter'); reset();
        filter('status', 'Waiting'); assert(cards().length === 1 && card('workspace/design'), 'status filter'); reset();
        filter('search', 'client order'); assert(cards().length === 1, 'title/project search'); reset();
        filter('search', '  DESIGN '); assert(cards().length === 2, 'case-insensitive label/category search'); reset();
        el('at-filter-toggle').click(); assert(el('at-filters').hidden, 'filter panel toggle'); el('at-filter-toggle').click();
        await status('youtube/same', 'In Progress');
        assert(store['hubs/youtube/tasks'][0].columnId === 'progress', 'moves original YouTube task to matching source column');
        assert(store['hubs/tiktok/tasks'][0].columnId === 'progress' && !store['hubs/tiktok/tasks'][0].allTasksStatus, 'same-ID TikTok task untouched');
        await status('youtube/same', 'Waiting');
        assert(store['hubs/youtube/tasks'][0].columnId === 'progress' && card('youtube/same').querySelector('select').value === 'Waiting', 'missing source column uses metadata without restructuring');
        assert(store['hubs/youtube/board_columns'].length === 3, 'no source columns added');
        store['hubs/youtube/tasks'][0].columnId = 'done'; emit('hubs/youtube/tasks');
        assert(card('youtube/same').querySelector('select').value === 'Done', 'subsequent source-board move overrides metadata');
        failWrite = true; await status('workspace/learn', 'Close');
        assert(card('workspace/learn').querySelector('select').value === 'Plan' && !card('workspace/learn').querySelector('select').disabled, 'failed move restores UI');
        assert(notifications.at(-1)[1] === true, 'failed move reports error'); failWrite = false;
        const transfer = new DataTransfer();
        card('workspace/learn').dispatchEvent(new DragEvent('dragstart', {dataTransfer:transfer, bubbles:true}));
        el('at-board').querySelector('[data-status="In Progress"]').dispatchEvent(new DragEvent('drop', {dataTransfer:transfer, bubbles:true,cancelable:true})); await tick();
        assert(store['hubs/workspace/tasks'][0].status === 'In Progress', 'drag drop persists status');
        card('youtube/same').querySelector('button').click();
        let form = el('all-tasks-editor').querySelector('form'); form.elements.text.value = 'Updated thumbnail'; form.elements.project.value = 'Orchestra';
        await submit();
        assert(store['hubs/youtube/tasks'][0].text === 'Updated thumbnail', 'editor updates source record');
        assert(store['hubs/youtube/tasks'][0].checklist[0].text === 'Keep' && store['hubs/youtube/tasks'][0].driveLink, 'preserves source-only fields');
        assert(!el('all-tasks-editor'), 'successful save closes editor');
        el('at-add').click(); form = el('all-tasks-editor').querySelector('form');
        form.elements.text.value = '   '; await submit();
        assert(!el('all-tasks-editor').querySelector('.at-error').hidden, 'reject blank task title');
        form.elements.text.value = '<img src=x onerror=alert(1)> Learn automation';
        form.elements.category.value = 'Learning'; form.elements.priority.value = 'High'; form.elements.tags.value = 'practice, practice, <script-test>';
        form.elements.dueDate.value = dates.today; form.elements.status.value = 'Waiting';
        failWrite = true; await submit();
        assert(el('all-tasks-editor') && !form.querySelector('[type=submit]').disabled, 'failed create remains retryable');
        failWrite = false; await submit();
        assert(writes.at(-1).ref === 'hubs/workspace/tasks', 'new independent task stored in Workspace');
        assert(card('workspace/new-1').textContent.includes('Learn automation') && !card('workspace/new-1').querySelector('img,script-test'), 'untrusted title and labels escaped');
        assert(store['hubs/workspace/tasks'].at(-1).tags.length === 2, 'labels deduplicated');
        card('workspace/new-1').querySelector('button').click();
        const dialog = el('all-tasks-editor');
        assert(dialog.open && dialog.getBoundingClientRect().width <= innerWidth, 'native editor fits viewport');
        dialog.querySelector('[data-cancel]').click(); await tick(); assert(!el('all-tasks-editor'), 'cancel dismisses dialog');
        el('at-add').click();
        el('all-tasks-editor').dispatchEvent(new MouseEvent('click', {clientX:0,clientY:0,bubbles:true})); await tick();
        assert(!el('all-tasks-editor'), 'outside click dismisses dialog');
        assert(document.documentElement.scrollWidth <= innerWidth, 'board scroll stays within page on desktop/mobile');
        assert(getComputedStyle(card('youtube/same')).backgroundColor === 'rgb(31, 41, 55)', 'existing dark card theme reused');
        document.documentElement.classList.remove('dark'); await tick();
        assert(getComputedStyle(card('youtube/same')).backgroundColor === 'rgb(255, 255, 255)', 'theme switch refreshes cards');
        document.documentElement.classList.add('dark'); await tick();
        subscriptions.get('hubs/working/tasks').error(new Error('permission-denied'));
        assert(!el('at-retry').hidden && el('at-notice').textContent.includes('working/tasks'), 'permission error visible, other tasks remain');
        el('at-retry').click(); assert(el('at-retry').hidden && unsubscribed === 9, 'retry replaces listeners');
        navigateTo('youtube'); await tick();
        assert(el('all-tasks-section').classList.contains('hidden') && !el('youtube-section').classList.contains('hidden'), 'YouTube navigation remains intact');
        assert(subscriptions.size === 0 && cards().length === 0, 'leaving releases listeners and task data');
        el('mobile-menu').classList.remove('hidden'); el('mobile-all-tasks-btn').click(); await tick();
        assert(!el('all-tasks-section').classList.contains('hidden') && el('mobile-menu').classList.contains('hidden'), 'mobile menu integration');
        navigateTo('tiktok'); await tick(); assert(!el('tiktok-section').classList.contains('hidden'), 'TikTok navigation remains intact');
        window.dispatchEvent(new PopStateEvent('popstate', {state:{target:'all-tasks'}}));
        assert(!el('all-tasks-section').classList.contains('hidden'), 'browser history restores view');
        history.replaceState({}, '', '#/all-tasks'); window.startAllTasks();
        assert(card('workspace/new-1').querySelector('select').value === 'Waiting', 'saved task survives re-entering menu');
        window.stopAllTasks(); auth.currentUser = null; window.startAllTasks();
        assert(subscriptions.size === 0 && el('at-notice').textContent.includes('Sign in'), 'signed-out view cannot subscribe');
        el('result').textContent = 'PASS: ' + assertions + ' assertions at width ' + innerWidth;
    } catch (error) { el('result').textContent = 'FAIL: ' + error.stack; }
    finally { window.stopAllTasks(); }
})();
`;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'all-tasks-test-'));
const requests = [];
const server = http.createServer((req, res) => {
    requests.push(req.url);
    const file = path.join(temp, path.basename(new URL(req.url, 'http://localhost').pathname));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
});
let origin;
async function runFixture(fixture, label, width) {
    const run = await new Promise((resolve, reject) => {
        const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-background-networking',
        '--user-data-dir=' + path.join(temp, 'profile-' + label + '-' + width), '--window-size=' + width + ',900',
        '--virtual-time-budget=8000', '--dump-dom', label.startsWith('file') ? pathToFileURL(fixture).href : origin + '/' + path.basename(fixture)],
        { timeout:45000 });
        let stdout = '', stderr = '';
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.on('error', reject);
        child.on('close', () => resolve({stdout, stderr}));
    });
    const result = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
    if (run.error || !result?.startsWith('PASS:')) throw new Error(label + ': ' + (result || run.error?.message || run.stderr));
    console.log(result);
}
(async () => {
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = 'http://127.0.0.1:' + server.address().port;
try {
    fs.copyFileSync(path.join(__dirname, 'all-tasks.js'), path.join(temp, 'all-tasks.js'));
    const header = slice('    <header', '    <main');
    const fixture = path.join(temp, 'test.html');
    fs.writeFileSync(fixture, `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>${fs.readFileSync(path.join(__dirname, 'all-tasks.css'), 'utf8')}\n${styles}
        *{box-sizing:border-box}body{margin:0}header{display:none}.hidden{display:none}main{padding:16px}button,input,select,textarea{font:inherit}button{cursor:pointer}#all-tasks-section{padding:16px}</style></head><body>
        ${header}<main><section id="all-tasks-section" class="hidden"></section>
        ${['project-board','daily-routine','important-notes','trade','skills','youtube','tiktok','ide'].map(id => '<section id="' + id + '-section" class="hidden"></section>').join('')}</main>
        <pre id="result">RUNNING</pre><script src="./all-tasks.js"></script><script type="module">
        const { normalizeWorkspaceTask, taskDateRange, localTaskDate } = window.AllTasks;
        delete window.AllTasks; // The actual loader must fetch and register the workspace again.
        ${setup}\n${theme}\n${nav}\n${integration}\n${tests}</script></body></html>`);
    for (const width of [1280, 480]) {
        await runFixture(fixture, 'workspace', width);
        await runFixture(fixture, 'file-workspace', width);
    }
    // Deliberately do NOT statically import All Tasks in these fixtures. The original
    // suite's static fixture import masked the main application's missing-file failure.
    const themeControls = slice('        // Theme handling:', '        // Initial setup');
    fs.writeFileSync(path.join(temp, 'broken.js'), 'window.AllTasks = { createAllTasksWorkspace() { throw new Error("Initialization failed"); } };');
    for (const scenario of ['missing', 'broken', 'file-missing', 'file-broken']) {
        const failureFixture = path.join(temp, scenario + '.html');
        const asset = scenario.replace('file-', '') + '.js';
        const isolatedIntegration = integration.replace('./all-tasks.js?v=4', './' + asset);
        fs.writeFileSync(failureFixture, `<!doctype html><html><head><meta charset="utf-8"><style>.hidden{display:none}</style></head><body>
            ${header}${['all-tasks','project-board','daily-routine','important-notes','trade','skills','youtube','tiktok','ide'].map(id => '<section id="' + id + '-section" class="hidden"></section>').join('')}
            <pre id="result">RUNNING</pre><script type="module">
            const failures = [];
            window.addEventListener('unhandledrejection', event => failures.push(event.reason));
            window.addEventListener('error', event => failures.push(event.message));
            const db = {}, auth = { currentUser: {uid:'test'} };
            const collection = () => {}, doc = () => {}, onSnapshot = () => { throw new Error('Unexpected subscription'); }, addDoc = () => {}, updateDoc = () => {};
            const applyYtCardTheme = () => {}, showNotification = () => {}, normalizeTradeColors = () => {};
            let currentMode = 'personal';
            const updateModeUI = () => {}, initYtBoard = () => {}, initYtBoardSettings = () => {}, initTtBoard = () => {}, initTtBoardSettings = () => {};
            ${nav}\n${isolatedIntegration}\n${themeControls}
            (async () => {
                let checks = 0;
                const assert = (ok, message) => { if (!ok) throw new Error(message); checks++; };
                const tick = () => new Promise(resolve => setTimeout(resolve, 30));
                try {
                    assert(document.documentElement.classList.contains('dark'), 'default theme initializes without All Tasks');
                    document.getElementById('theme-toggle').click();
                    assert(!document.documentElement.classList.contains('dark'), 'theme button works before opening All Tasks');
                    document.getElementById('all-tasks-btn').click(); await tick(); await window.startAllTasks();
                    assert(document.querySelector('#all-tasks-section [role=alert]'), 'module failure has a local error message');
                    const detail = document.getElementById('at-load-error');
                    assert(detail && detail.textContent.includes('${asset}'), 'actual failure detail and script URL are visible');
                    if ('${scenario}'.includes('broken')) assert(detail.textContent.includes('Initialization failed'), 'initialization error is preserved');
                    document.querySelector('#all-tasks-section button').click(); await tick(); await window.startAllTasks();
                    assert(document.querySelector('#all-tasks-section [role=alert]'), 'retry failure stays contained');
                    navigateTo('youtube');
                    assert(!document.getElementById('youtube-section').classList.contains('hidden'), 'YouTube navigation survives');
                    navigateTo('tiktok');
                    assert(!document.getElementById('tiktok-section').classList.contains('hidden'), 'TikTok navigation survives');
                    navigateTo('board');
                    assert(!document.getElementById('project-board-section').classList.contains('hidden'), 'original board navigation survives');
                    document.getElementById('theme-toggle').click();
                    assert(document.documentElement.classList.contains('dark'), 'theme button still works after failure');
                    await tick(); assert(failures.length === 0, 'no uncaught errors or rejected promises');
                    document.getElementById('result').textContent = 'PASS: ' + checks + ' isolation checks (${scenario} module)';
                } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
                finally { window.stopAllTasks(); }
            })();</script></body></html>`);
        await runFixture(failureFixture, scenario, 1280);
    }
    const missingRequests = requests.filter(url => url.startsWith('/missing.js'));
    if (!missingRequests.some(url => url.includes('retry=')) || new Set(missingRequests).size < 2) throw new Error('Retry must use a fresh module URL after a failed download.');
    console.log('PASS: HTTP and file:// classic-script loading and fresh retry URLs (no file-access bypass flags).');
    console.log('Classic script and inline syntax: PASS. No live Firestore reads/writes.');
} finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, {recursive:true, force:true, maxRetries:5, retryDelay:300});
}
})().catch(error => { console.error(error); process.exitCode = 1; });