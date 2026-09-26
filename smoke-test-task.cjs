// Run: node smoke-test-task.cjs. Uses installed Chrome/Edge, no live Firebase calls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const slice = (start, end) => {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    if (a < 0 || b < 0) throw new Error('Missing source marker: ' + start);
    return html.slice(a, b);
};
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/src=|application\/ld\+json/.test(script[1])) continue;
    new vm.Script(script[2].replace(/^\s*import\s.*?;\s*$/gm, ''));
}
const nav = slice('        const sections = {', '        // --- Settings Navigation JS ---');
const ytSettings = slice('        const initYtBoardSettings = () => {', "        document.getElementById('youtube-btn')?.addEventListener('click', () => {");
const ttSettings = slice('        const initTtBoardSettings = () => {', "        document.getElementById('tiktok-btn')?.addEventListener('click', () => {");
const config = slice('        const DEFAULT_MENU_VISIBILITY = {', '        let menuVisibility');
const markup = slice('    <header', '    <script type="module">')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const browser = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH to installed Chrome/Edge');
const setup = `
const el = id => document.getElementById(id);
let currentMode = 'personal';
const updateModeUI = () => {}, switchMode = () => {}, normalizeTradeColors = () => {};
const auth = { currentUser: null }, currentUserUid = null;
const renderIdeaBank = () => {};
const calls = { youtube:0, tiktok:0, schedule:0 }, notifications = [];
const initYtBoard = () => calls.youtube++;
const initTtBoard = () => calls.tiktok++;
const initTtSchedule = () => calls.schedule++;
const showNotification = (...args) => notifications.push(args);
const ids = ['yt-project-board-panel', 'tt-project-board-panel', 'yt-upload-summary', 'ttsch-panel'];
const originals = ids.map(id => ({ node:el(id), parent:el(id).parentNode, next:el(id).nextSibling }));
let clicks = 0;
el('yt-project-board-panel').addEventListener('task-test', () => clicks++);
`;
const tests = `
(async () => {
    let count = 0;
    const assert = (ok, message) => { if (!ok) throw new Error(message); count++; };
    const wait = () => new Promise(resolve => setTimeout(resolve, 180));
    const visible = node => !!node.getClientRects().length;
    const checkTask = () => {
        assert(visible(el('task-section')), 'Task visible');
        assert(!visible(el('youtube-section')) && !visible(el('tiktok-section')), 'source inventory hidden');
        assert(el('task-btn').getAttribute('aria-pressed') === 'true', 'active Task icon');
        assert(ids.every(id => el('task-section').contains(el(id))), 'all four panels mounted');
        assert(ids.every(id => document.querySelectorAll('#' + id).length === 1), 'no duplicated panels');
        assert(originals.every(item => el(item.node.id) === item.node), 'original live nodes retained');
        const slots = [...document.querySelector('.task-panel-stack').children];
        assert(slots.map(slot => slot.querySelector('div[id]').id).join(',') === ids.join(','), 'requested order');
        assert(getComputedStyle(document.querySelector('.task-panel-stack')).gridTemplateColumns.split(' ').length === 1, 'single vertical column');
        for (let i = 1; i < slots.length; i++) {
            assert(slots[i].getBoundingClientRect().top >= slots[i-1].getBoundingClientRect().bottom, 'panels stack without overlap');
        }
        for (const slot of slots) assert(slot.getBoundingClientRect().right <= innerWidth, 'slot fits viewport');
    };
    try {
        await wait();
        assert(DEFAULT_MENU_VISIBILITY.task === true && MENU_DISPLAY_NAMES.task === 'Task', 'Task enabled by default');
        assert(el('task-btn').querySelector('.fa-tasks'), 'desktop checklist icon');
        assert(el('mobile-task-btn').querySelector('.fa-tasks'), 'mobile checklist icon');
        assert(document.querySelector('[data-setting-menu="task"]'), 'menu visibility toggle exists');
        if (parseHash() === 'task') checkTask();
        el('task-btn').click(); await wait(); checkTask();
        assert(calls.youtube && calls.tiktok && calls.schedule, 'both boards and TikTok schedule initialized');
        assert(location.hash === '#/task', 'shareable route');
        assert(visible(document.querySelector('.task-schedule-empty')), 'YouTube empty state');
        el('yt-upload-summary').classList.remove('hidden');
        assert(!visible(document.querySelector('.task-schedule-empty')), 'empty message hidden with schedule');
        el('yt-project-board-panel').dispatchEvent(new Event('task-test'));
        assert(clicks === 1, 'existing event listeners retained');
        for (const target of ['youtube', 'tiktok', 'board', 'trade', 'skills', 'ide', 'daily', 'notes']) {
            navigateTo(target); await wait();
            assert(!visible(el('task-section')), 'Task hidden on ' + target);
            assert(originals.every(item => item.node.parentNode === item.parent && item.node.nextSibling === item.next), 'exact original placement on ' + target);
            assert(el('task-btn').getAttribute('aria-pressed') === 'false', 'Task inactive on ' + target);
            navigateTo('task'); await wait(); checkTask();
        }
        for (const platform of ['yt', 'tt']) {
            const init = platform === 'yt' ? initYtBoardSettings : initTtBoardSettings;
            init(); init();
            const popover = el(platform + '-board-settings-popover');
            popover.classList.add('hidden');
            el(platform + '-board-settings-btn').click();
            assert(!popover.classList.contains('hidden'), 'settings open once after repeated navigation: ' + platform);
            el(platform + '-board-settings-btn').click();
            assert(popover.classList.contains('hidden'), 'settings close once: ' + platform);
        }
        navigateTo('youtube');
        el('mobile-menu').classList.remove('hidden');
        el('mobile-task-btn').click(); await wait(); checkTask();
        assert(el('mobile-menu').classList.contains('hidden'), 'mobile menu closes');
        window.dispatchEvent(new PopStateEvent('popstate', { state:{ target:'youtube' } }));
        assert(!visible(el('task-section')), 'history exit restores source');
        window.dispatchEvent(new PopStateEvent('popstate', { state:{ target:'task' } }));
        await wait(); checkTask();
        document.documentElement.classList.add('dark'); checkTask();
        assert(!document.body.classList.contains('trade-full'), 'trade layout not retained');
        assert(notifications.length === 0, 'no initialization errors');
        el('result').textContent = 'PASS: ' + count + ' Task assertions at width ' + innerWidth;
    } catch (error) { el('result').textContent = 'FAIL: ' + error.stack; }
})();
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-overview-test-'));
try {
    const fixture = path.join(temp, 'test.html');
    // Minimal utility fallback: scoped application CSS is real, Tailwind CDN is not fetched.
    fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><style>${styles}
        .hidden { display:none; } * { box-sizing:border-box; } body { margin:0; }
        main { width:100%; padding:16px; } #task-section { padding:16px; }
        </style></head><body>${markup}<pre id="result">RUNNING</pre>
        <script>${setup}\n${config}\n${ytSettings}\n${ttSettings}\n${nav}\n${tests}</script></body></html>`);
    for (const [width, route] of [[1280, 'board'], [480, 'task']]) {
        const run = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', '--disable-background-networking',
            '--user-data-dir=' + path.join(temp, 'profile-' + width), '--window-size=' + width + ',900',
            '--virtual-time-budget=10000', '--dump-dom', pathToFileURL(fixture).href + '#/' + route
        ], { encoding:'utf8', timeout:45000, maxBuffer:8 * 1024 * 1024 });
        const result = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
        if (run.error || run.status !== 0 || !result?.startsWith('PASS:')) throw new Error(result || run.error?.message || run.stderr);
        console.log(result);
    }
    console.log('Inline syntax PASS. Real navigation, panel markup and settings tested; data initializers mocked, CDN utilities not loaded.');
} finally {
    fs.rmSync(temp, { recursive:true, force:true, maxRetries:5, retryDelay:300 });
}