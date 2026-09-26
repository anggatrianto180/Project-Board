// Run: node smoke-test-tiktok.cjs
// Uses installed Chrome/Edge and fake Firestore writes; no dependencies or live data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/src=|application\/ld\+json/.test(script[1])) continue;
    new vm.Script(script[2].replace(/^\s*import\s.*?;\s*$/gm, ''));
}
const start = html.indexOf('        let ttschAccounts = []');
const end = html.indexOf('        // ---- Initialize on nav to TikTok ----', start);
if (start < 0 || end < 0) throw new Error('TikTok schedule section not found');
const source = html.slice(start, end);
const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
const browser = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH to an installed Chrome/Edge executable');

const setup = `
const notifications = [];
const showNotification = (...args) => notifications.push(args);
const isDark = () => true;
const escapeHtml = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const db = {};
let nextId = 0, commits = 0, failCommit = false;
const collection = (...parts) => ({ parts });
const snapshots = {};
const onSnapshot = (ref, callback) => {
    snapshots[ref.parts.at(-1)] = callback;
    return () => {};
};
const emitSnapshot = (name, records) => snapshots[name]({ docs:records.map(({ id, ...data }) => ({ id, data:() => data })) });
const doc = (...parts) => ({ id: typeof parts[parts.length - 1] === 'string' ? parts[parts.length - 1] : 'generated-' + (++nextId) });
const writeBatch = () => {
    const writes = [];
    return {
        set: (ref, data) => writes.push({ ref, data }),
        update: (ref, data) => writes.push({ ref, data }),
        commit: async () => {
            commits++;
            if (failCommit) throw new Error('Simulated failure');
            for (const { ref, data } of writes) {
                const current = ttschSchedules.find(s => s.id === ref.id);
                if (current) Object.assign(current, data);
                else ttschSchedules.push({ id: ref.id, ...data });
            }
        }
    };
};
const updateDoc = async (ref, data) => Object.assign(ttschSchedules.find(s => s.id === ref.id), data);
`;
const tests = `
(async () => {
    let assertions = 0;
    const assert = (condition, message) => { if (!condition) throw new Error(message); assertions++; };
    const el = id => document.getElementById(id);
    const input = (selector, value) => { const node = document.querySelector(selector); node.value = value; node.dispatchEvent(new Event('input')); };
    const setRange = value => { el('ttsch-sel-range').value = value; el('ttsch-sel-range').onchange(); };
    try {
        assert(ttschBuildScheduleDates('2026-09-26', 'month').length === 30, 'month has 30 days');
        assert(ttschBuildScheduleDates('2026-01-31', 'month').at(-1) === '2026-02-27', 'clamped month end is exclusive');
        assert(ttschBuildScheduleDates('2024-02-01', 'month').length === 29, 'leap month');
        assert(ttschBuildScheduleDates('2026-12-29', 'week').at(-1) === '2027-01-04', 'week crosses year');
        assert(ttschBuildScheduleDates('2026-02-30', 'month').length === 0, 'reject invalid date');
        assert(ttschBuildScheduleDates('', 'month').length === 0, 'reject empty date');
        assert(ttschBuildScheduleDates('2026-01-01', 'other').length === 0, 'reject invalid range');
        ttschOpenAddScheduleModal(null);
        assert(!el('ttsch-add-modal'), 'require account before adding');
        ttschAccounts = [{ id:'a1', username:'creator' }, { id:'a2', username:'second' }];
        initTtSchedule();
        emitSnapshot('sch_accounts', ttschAccounts);
        assert(ttschActiveAccountId === null && el('ttsch-summary-account').value === '', 'initial account snapshot defaults to all accounts');
        emitSnapshot('sch_entries', [
            { id:'init1', accountId:'a1', date:ttschDateStr(new Date()), videos:[{ id:'iv1', title:'First account video' }] },
            { id:'init2', accountId:'a2', date:ttschDateStr(new Date()), videos:[{ id:'iv2', title:'Second account video' }] }
        ]);
        assert(el('ttsch-summary').querySelectorAll('.ttsch-summary-account-group').length === 2, 'initial schedule shows videos from all accounts');
        emitSnapshot('sch_accounts', ttschAccounts);
        assert(ttschActiveAccountId === null, 'realtime account refresh keeps all accounts selected');
        ttschActiveAccountId = 'a2';
        emitSnapshot('sch_accounts', ttschAccounts);
        assert(ttschActiveAccountId === 'a2', 'realtime refresh preserves manual filter');
        ttschActiveAccountId = 'removed-account';
        emitSnapshot('sch_accounts', ttschAccounts);
        assert(ttschActiveAccountId === null, 'missing selected account falls back to all');
        emitSnapshot('sch_entries', []);
        ttschActiveAccountId = 'a1';
        ttschOpenAddScheduleModal('2026-09-26');
        assert(el('ttsch-sel-range').value === 'month', 'month is default');
        assert(!document.querySelector('#ttsch-add-modal input[type=checkbox]'), 'no add form checklists');
        assert(!document.querySelector('#ttsch-add-modal [data-field=notes]'), 'no add form notes');
        assert(el('ttsch-add-preview').children.length === 7, 'seven day preview');
        await el('ttsch-add-submit').onclick();
        assert(commits === 0 && el('ttsch-add-modal'), 'empty title cannot save');
        input('[data-field=title]', 'Review "produk" <aman>');
        input('[data-field=uploadTime]', '18:30');
        el('ttsch-modal-add-vid').click();
        assert(document.querySelector('[data-field=title]').value === 'Review "produk" <aman>', 'title preserved and escaped');
        input('[data-field=title][data-idx="1"]', 'Tutorial');
        assert(el('ttsch-add-total').textContent.includes('60 video'), 'preview updates video count');
        setRange('today');
        assert(el('ttsch-sel-date').disabled, 'today locks start date');
        assert(el('ttsch-sel-date').value === ttschDateStr(new Date()), 'today uses local date');
        assert(el('ttsch-add-preview').children.length === 1, 'today previews one day');
        setRange('week');
        assert(!el('ttsch-sel-date').disabled && el('ttsch-sel-date').value === '2026-09-26', 'restore selected start date');
        assert(el('ttsch-add-total').textContent.includes('14 video'), 'weekly count');
        ttschSchedules = [{ id:'existing', accountId:'a1', date:'2026-09-26', videos:[{ id:'old', title:'Existing', recorded:true, uploaded:true }] }];
        const submit = el('ttsch-add-submit');
        const firstSave = submit.onclick();
        await submit.onclick();
        await firstSave;
        assert(commits === 1, 'ignore duplicate submit');
        assert(!el('ttsch-add-modal'), 'close after success');
        assert(ttschSchedules.length === 7, 'seven daily entries');
        assert(ttschSchedules[0].videos[0].uploaded, 'preserve existing status');
        assert(ttschSchedules[0].videos.length === 3, 'append to existing date');
        const newVideos = ttschSchedules.flatMap(s => s.videos).filter(v => v.id !== 'old');
        assert(newVideos.length === 14 && new Set(newVideos.map(v => v.id)).size === 14, 'unique ids per video and date');
        assert(newVideos.every(v => !v.recorded && !v.uploaded && !('notes' in v)), 'default statuses without notes');
        assert(el('ttsch-summary').textContent.includes('Jadwal Upload TikTok'), 'summary rendered');
        assert(el('ttsch-summary').textContent.includes('33%'), 'summary progress per video');
        assert(!el('ttsch-summary').querySelector('aman'), 'summary title escaped');
        assert(!el('ttsch-body') && !el('ttsch-account-tabs'), 'old calendar section removed');
        assert(el('ttsch-summary').querySelectorAll('.ttsch-summary-day').length === 3, 'three day summary');
        assert(el('ttsch-summary').querySelectorAll('[data-date]')[2].dataset.date === '2026-09-28', 'third date shown');
        const check = el('ttsch-summary').querySelector('input[data-field=uploaded][data-video=old]');
        await check.onchange();
        assert(!ttschSchedules[0].videos[0].uploaded, 'summary upload tracker works');
        ttschActiveAccountId = 'a2'; ttschRenderAll();
        assert(!el('ttsch-summary').textContent.includes('Existing'), 'summary honors account filter');
        ttschActiveAccountId = 'a1';
        ttschOpenAddScheduleModal('2026-10-01');
        input('[data-field=title]', 'Monthly video');
        failCommit = true;
        await el('ttsch-add-submit').onclick();
        assert(el('ttsch-add-modal') && !el('ttsch-add-submit').disabled, 'failed save remains retryable');
        assert(ttschSchedules.length === 7, 'failure writes nothing');
        failCommit = false;
        await el('ttsch-add-submit').onclick();
        assert(ttschSchedules.filter(s => s.date.startsWith('2026-10')).length === 31, 'save full calendar month');
        ttschOpenAddScheduleModal('2020-01-01');
        setRange('today'); input('[data-field=title]', 'Today only');
        await el('ttsch-add-submit').onclick();
        assert(ttschSchedules.some(s => s.date === ttschDateStr(new Date()) && s.videos.some(v => v.title === 'Today only')), 'save today regardless of original date');
        assert(ttschGetDetailDates('week', new Date(2026, 8, 27)).join(',') === '2026-09-21,2026-09-22,2026-09-23,2026-09-24,2026-09-25,2026-09-26,2026-09-27', 'Sunday belongs to current Monday-Sunday week');
        assert(ttschGetDetailDates('week', new Date(2026, 11, 31)).at(-1) === '2027-01-03', 'detail week crosses year');
        assert(ttschGetDetailDates('month', new Date(2024, 1, 20)).length === 29, 'detail leap February');
        assert(ttschGetDetailDates('month', new Date(2026, 11, 31)).at(-1) === '2026-12-31', 'detail December boundary');
        const summaryBefore = el('ttsch-summary').innerHTML;
        for (const period of ['today', 'week', 'month']) {
            el('ttsch-summary').querySelector('[data-period=' + period + ']').click();
            const modal = el('ttsch-details-modal');
            const dates = ttschGetDetailDates(period);
            assert(modal.open, period + ' opens popup');
            assert(modal.querySelectorAll('[data-date]').length === dates.length, period + ' includes all dates');
            assert(modal.querySelector('[data-date]').dataset.date === dates[0], period + ' starts on correct date');
            assert(modal.textContent.includes('Today only'), period + ' shows scheduled title');
            assert(modal.getBoundingClientRect().width <= innerWidth, period + ' popup fits screen');
            assert(el('ttsch-summary').innerHTML === summaryBefore, period + ' does not change main preview');
            modal.querySelector('[data-close]').click();
            assert(!modal.open, period + ' closes popup');
        }
        ttschOpenDetails('today');
        const todayCheck = el('ttsch-details-modal').querySelector('input[data-field=uploaded]');
        const entryId = todayCheck.dataset.entry, videoId = todayCheck.dataset.video;
        const previousStatus = ttschSchedules.find(s => s.id === entryId).videos.find(v => v.id === videoId).uploaded;
        await todayCheck.onchange();
        assert(ttschSchedules.find(s => s.id === entryId).videos.find(v => v.id === videoId).uploaded !== previousStatus, 'popup tracker saves status');
        assert(el('ttsch-details-modal').querySelector('input[data-field=uploaded]').checked !== previousStatus, 'popup tracker refreshes');
        const filter = el('ttsch-summary-account');
        filter.value = 'a2'; filter.onchange({ target:filter });
        assert(!el('ttsch-details-modal').textContent.includes('Today only'), 'popup respects account filter after refresh');
        assert(el('ttsch-details-modal').textContent.includes('Tidak ada jadwal upload.'), 'popup empty state');
        el('ttsch-details-modal').close();
        ttschActiveAccountId = 'a1'; ttschNavigateSummary(0);
        ttschOpenDetails('today');
        el('ttsch-details-modal').querySelector('[data-edit-entry]').click();
        assert(!el('ttsch-details-modal')?.open && el('ttsch-ev-title'), 'popup edit opens usable editor');
        el('ttsch-ev-close').click();
        ttschOpenDetails('today');
        el('ttsch-details-modal').querySelector('[data-add-date]').click();
        assert(!el('ttsch-details-modal')?.open && el('ttsch-add-modal'), 'popup add opens usable form');
        el('ttsch-add-close').click();
        assert(el('ttsch-summary').textContent.includes('LUSA'), 'today tomorrow and day after labels');
        el('ttsch-summary-add-account').click();
        assert(el('ttsch-acc-modal'), 'add account remains accessible');
        el('ttsch-acc-close').click();
        ttschSummaryDate = new Date(2026, 11, 31); ttschRenderSummary();
        assert(el('ttsch-summary').querySelectorAll('[data-date]')[2].dataset.date === '2027-01-02', 'three day preview crosses year');
        ttschAccounts = [{ id:'a1', name:'Akun 1 <aman>', username:'creator' }, { id:'a2', name:'Akun 3', username:'second' }];
        ttschSchedules = [
            { id:'group1', accountId:'a1', date:'2026-12-31', videos:[{ id:'g1', title:'Tanaman 2', uploadTime:'11:00', recorded:false, uploaded:false }] },
            { id:'group2', accountId:'a2', date:'2026-12-31', videos:[{ id:'g2', title:'Tanaman 3', uploadTime:'08:00', recorded:true, uploaded:true }] },
            { id:'group3', accountId:'a1', date:'2026-12-31', videos:[{ id:'g3', title:'Tanaman 1', uploadTime:'06:00', recorded:false, uploaded:false }] }
        ];
        ttschActiveAccountId = null; ttschRenderAll();
        const firstDay = () => el('ttsch-summary').querySelector('.ttsch-summary-day');
        const groups = firstDay().querySelectorAll('.ttsch-summary-account-group');
        assert(groups.length === 2, 'one group per account even across separate entries');
        assert(groups[0].querySelector('h4').textContent === 'Akun 1 <aman>' && !groups[0].querySelector('aman'), 'account label is escaped');
        assert([...groups[0].querySelectorAll('b')].map(b => b.textContent).join(',') === 'Tanaman 1,Tanaman 2', 'account titles grouped and sorted by upload time');
        assert(groups[1].querySelectorAll('.ttsch-summary-row').length === 1 && groups[1].textContent.includes('Akun 3'), 'second account has its own titles');
        assert(!groups[0].querySelector('.ttsch-summary-video').textContent.includes('@creator'), 'account not repeated on each video');
        const editIcon = groups[0].querySelector('[data-edit-entry]');
        assert(editIcon.parentElement.classList.contains('ttsch-summary-video-heading') && editIcon.previousElementSibling.tagName === 'B', 'edit beside title');
        assert(!editIcon.textContent.trim() && editIcon.querySelector('.fa-pen') && editIcon.getAttribute('aria-label').includes('Tanaman 1'), 'icon-only edit has accessible label');
        editIcon.querySelector('i').click();
        assert(el('ttsch-ev-title').value === 'Tanaman 1', 'clicking edit icon opens correct video');
        assert(el('ttsch-ev-recorded').parentElement.textContent.includes('Dibuat'), 'editor uses Dibuat label');
        el('ttsch-ev-close').click();
        const madeCheck = firstDay().querySelector('input[data-field=recorded][data-video=g3]');
        assert(madeCheck.parentElement.textContent === 'Dibuat' && firstDay().textContent.includes('Belum Dibuat'), 'list uses Dibuat labels');
        await madeCheck.onchange();
        assert(ttschSchedules[2].videos[0].recorded && firstDay().querySelector('[data-video=g3][data-field=recorded]').checked, 'Dibuat persists using existing recorded field');
        assert(firstDay().querySelector('[data-video=g3][data-field=recorded]').closest('.ttsch-summary-row').textContent.includes('Siap Upload'), 'made video becomes ready to upload');
        assert(notifications.at(-1)[0].includes('Dibuat'), 'notification uses Dibuat');
        assert(firstDay().querySelector('[data-video=g2][data-field=uploaded]').checked, 'other account upload status preserved');
        const accountFilter = el('ttsch-summary-account');
        accountFilter.value = 'a2'; accountFilter.onchange({ target:accountFilter });
        assert(firstDay().querySelectorAll('.ttsch-summary-account-group').length === 1 && !firstDay().textContent.includes('Akun 1'), 'grouped list honors selected account');
        ttschActiveAccountId = null; ttschRenderAll();
        for (const row of firstDay().querySelectorAll('.ttsch-summary-row')) {
            assert(row.scrollWidth <= row.clientWidth, 'grouped row fits viewport');
        }
        ttschOpenAddScheduleModal(null);
        if (innerWidth <= 640) {
            assert(getComputedStyle(document.querySelector('.ttsch-summary-columns')).gridTemplateColumns.split(' ').length === 1, 'mobile summary stacks');
            assert(document.querySelector('.ttsch-form').getBoundingClientRect().width <= innerWidth, 'modal fits mobile width');
        } else {
            assert(getComputedStyle(document.querySelector('.ttsch-summary-columns')).gridTemplateColumns.split(' ').length === 3, 'desktop three column summary');
        }
        el('result').textContent = 'PASS: ' + assertions + ' assertions at width ' + innerWidth;
    } catch (error) { el('result').textContent = 'FAIL: ' + error.stack; }
})();
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-schedule-test-'));
try {
    const fixture = path.join(temp, 'test.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>
        ${html.slice(html.indexOf('<div id="ttsch-panel"'), html.indexOf('<!-- HP Tab Bar -->', html.indexOf('<div id="ttsch-panel"')))}
        <pre id="result">RUNNING</pre><script>${setup}\n${source}\n${tests}</script></body></html>`);
    for (const width of [1280, 480]) {
        const run = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', '--disable-background-networking', '--allow-file-access-from-files',
            '--user-data-dir=' + path.join(temp, 'profile-' + width), '--window-size=' + width + ',900',
            '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(fixture).href
        ], { encoding:'utf8', timeout:45000, maxBuffer:5 * 1024 * 1024 });
        const result = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
        if (run.error || !result?.startsWith('PASS:')) throw new Error(result || run.error?.message || run.stderr);
        console.log(result);
    }
    console.log('Inline script syntax: PASS. Firestore writes were mocked.');
} finally {
    fs.rmSync(temp, { recursive:true, force:true, maxRetries:5, retryDelay:300 });
}