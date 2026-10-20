// Run: node smoke-test-youtube-live.cjs (installed Chrome/Edge; no live database writes)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const start = html.indexOf('        const getYtLiveDayIndex =');
const end = html.indexOf('        const rebuildYtLiveCheckedSlotsForDay =', start);
if (start < 0 || end < 0) throw new Error('Live editor source not found');
const browser = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH to Chrome/Edge');
const setup = `
let currentYtLiveChannelId = 'test';
let ytLiveConfig = { masterVideos: [{ name: 'Music', pubKey: 'public-key', unlKey: 'unlisted-key' }] };
let ytLiveScheduleData = ['2026-10-20', '2026-10-27', '2026-10-28'].map(isoDate => ({
    isoDate, slots: [{ slotNumber: 1, videoName: 'Music', startTimeWIB: '17:37 WIB', isPublic: true, durationDecimal: 2 }]
}));
const ytLiveCheckedSlots = {}, writes = [];
const escHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const addHoursToTime = (time, hours) => {
    const [h, m] = time.split(':').map(Number);
    const total = (h * 60 + m + hours * 60) % 1440;
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
};
const wibToEst = time => addHoursToTime(time, 12) + ' EST';
const ytLiveChannelConfigRef = id => id;
const setDoc = async (ref, data) => writes.push({ ref, data });
const saveYtLiveScheduleChange = async () => writes.push({ schedule: ytLiveScheduleData });
const renderYtLiveSchedule = () => {};
const showNotification = () => {};
`;
const tests = `
(async () => {
    let count = 0;
    const assert = (value, message) => { if (!value) throw new Error(message); count++; };
    const modal = () => document.querySelector('.yt-live-edit-dialog');
    const closeTick = () => new Promise(resolve => setTimeout(resolve, 100));
    try {
        let pending = ytLiveEditSlot('2026-10-20', 1);
        assert(modal().open && modal().matches(':modal'), 'edit opens modal popup');
        let form = modal().querySelector('form');
        assert(form.elements.startTime.tagName === 'SELECT', 'time is a select');
        assert(form.elements.startTime.value === '17:37', 'non-quarter-hour existing time preserved');
        assert(form.elements.startTime.options.length === 97, 'quarter-hour choices plus original time');
        assert([...form.elements.slotType.options].map(o => o.value).join() === 'public,unlisted', 'visibility choices');
        await ytLiveEditSlot('2026-10-20', 1);
        assert(document.querySelectorAll('dialog').length === 1, 'duplicate popup prevented');
        form.elements.startTime.value = '23:45';
        form.elements.slotType.value = 'unlisted';
        form.requestSubmit(); await pending; await closeTick();
        assert(!modal(), 'save closes modal');
        assert(writes.length === 2, 'config and schedule persisted');
        assert(ytLiveScheduleData[0].slots[0].startTimeWIB === '23:45 WIB', 'selected time saved');
        assert(ytLiveScheduleData[0].slots[0].endTimeWIB === '01:45 WIB', 'overnight end time recalculated');
        assert(ytLiveScheduleData[1].slots[0].streamKey === 'unlisted-key', 'recurring visibility uses correct key');
        assert(ytLiveScheduleData[2].slots[0].isPublic, 'other weekday unchanged');
        for (const method of ['cancel', 'escape', 'backdrop']) {
            pending = ytLiveEditSlot('2026-10-20', 1);
            form = modal().querySelector('form');
            assert(form.elements.slotType.value === 'unlisted', 'saved visibility preselected');
            form.click(); // Interior interaction must not consume the backdrop close handler.
            form.elements.slotType.value = 'public';
            if (method === 'cancel') modal().querySelector('[data-cancel]').click();
            else if (method === 'escape') modal().dispatchEvent(new Event('cancel', { cancelable: true }));
            else modal().click();
            await pending;
            assert(!modal() && writes.length === 2, method + ' closes without saving');
        }
        pending = ytLiveEditSlot('2026-10-20', 1);
        form = modal().querySelector('form');
        form.elements.slotType.value = 'public';
        form.requestSubmit(); await pending; await closeTick();
        assert(ytLiveScheduleData[0].slots[0].streamKey === 'public-key', 'switch back to public');
        document.getElementById('result').textContent = 'PASS: ' + count + ' Live editor assertions';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
})();
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-live-test-'));
try {
    const fixture = path.join(temp, 'test.html');
    fs.writeFileSync(fixture, `<!doctype html><html><body><pre id="result">RUNNING</pre>
        <script>window.addEventListener('error', event => { document.getElementById('result').textContent = 'FAIL: ' + (event.error?.stack || event.message); }); setTimeout(() => { if (document.getElementById('result').textContent === 'RUNNING') document.getElementById('result').textContent = 'FAIL: test timeout'; }, 1000);</script>
        <script>${setup}\n${html.slice(start, end)}\n${tests}</script></body></html>`);
    const run = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-background-networking', '--allow-file-access-from-files',
        '--user-data-dir=' + path.join(temp, 'profile'), '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(fixture).href
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024 });
    const result = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
    if (run.error || !result?.startsWith('PASS:')) throw new Error(result || run.error?.message || run.stderr);
    console.log(result);
    console.log('Firestore writes mocked; live data not modified.');
} finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}