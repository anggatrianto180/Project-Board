// Run: node smoke-test-youtube.cjs
// Uses installed Chrome/Edge with a fixed local date and mocked Firestore writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const start = html.indexOf('        const renderYtUploadSummary =');
const end = html.indexOf('        // SEND SCHEDULE REPORT TO TELEGRAM', start);
if (start < 0 || end < 0) throw new Error('YouTube summary section not found');
const source = html.slice(start, end);
const browser = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(file => file && fs.existsSync(file));
if (!browser) throw new Error('Set CHROME_PATH to an installed Chrome/Edge executable');

const setup = `
const NativeDate = Date;
window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [2026, 11, 31, 12])); }
};
window._ytSummaryDayOffset = 0;
const db = {}, currentYtAdsenseTab = 'combined';
const writes = [];
const doc = (...parts) => parts;
const ytChannelCollectionName = id => 'channels-' + id;
const updateDoc = async (ref, data) => { writes.push({ ref, data }); };
const showNotification = () => {};
const showConfirmModal = async () => true;
const openTelegramReportModal = () => {};
`;
const tests = `
(async () => {
    let assertions = 0;
    const assert = (condition, message) => { if (!condition) throw new Error(message); assertions++; };
    const summary = document.getElementById('yt-upload-summary');
    const dates = () => [...summary.querySelectorAll('[data-summary-date]')].map(el => el.dataset.summaryDate);
    const third = () => summary.querySelectorAll('[data-summary-date]')[2];
    const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
    try {
        const channel = { id:'one', name:'Channel One', isCombinedAdsense:true, sourceAdsenseId:'source',
            uploadSchedules:{ '2026-12-31':true, '2027-01-01':true, '2027-01-02':true },
            uploads:{ '2026-12-31':true }, readyVideos:{ '2027-01-01':true } };
        const excluded = { id:'excluded', name:'Excluded Channel', isCombinedAdsense:false, uploadSchedules:{ '2027-01-02':true } };
        const channels = [channel, excluded];
        renderYtUploadSummary(channels);
        assert(dates().join(',') === '2026-12-31,2027-01-01,2027-01-02', 'three local dates across year boundary');
        assert(summary.querySelector('.yt-summary-columns').classList.contains('md:grid-cols-3'), 'desktop uses three-column utility');
        assert(summary.querySelector('.yt-summary-columns').classList.contains('grid-cols-1'), 'mobile uses single-column utility');
        assert(third().textContent.includes('LUSA') && third().textContent.includes('Channel One'), 'third day shows label and schedule');
        assert(!summary.textContent.includes('Excluded Channel'), 'combined Adsense filter preserved');
        assert(summary.querySelector('[data-summary-date="2026-12-31"] .yt-summary-upload-chk').checked, 'today upload retained');
        assert(summary.querySelector('[data-summary-date="2027-01-01"] .yt-summary-ready-chk').checked, 'tomorrow ready status retained');
        const ready = third().querySelector('.yt-summary-ready-chk');
        ready.checked = true; ready.dispatchEvent(new Event('change')); await settle();
        assert(channel.readyVideos['2027-01-02'] && third().querySelector('.yt-summary-ready-chk').checked, 'third-day ready checklist saves and refreshes');
        assert(writes.at(-1).ref[1] === 'channels-source', 'third-day write uses source Adsense');
        const upload = third().querySelector('.yt-summary-upload-chk');
        upload.checked = true; upload.dispatchEvent(new Event('change')); await settle();
        assert(channel.uploads['2027-01-02'] && third().textContent.includes('Sudah diupload'), 'third-day upload checklist saves and refreshes');
        assert(!third().querySelector('.yt-summary-cancel-btn'), 'uploaded schedule cannot be cancelled');
        upload.checked = false;
        third().querySelector('.yt-summary-upload-chk').click(); await settle();
        assert(!channel.uploads['2027-01-02'], 'third-day upload can be unchecked');
        third().querySelector('.yt-summary-postpone-btn').click(); await settle();
        assert(!channel.uploadSchedules['2027-01-02'] && channel.uploadSchedules['2027-01-03'], 'third-day postpone moves schedule to next day');
        assert(third().textContent.includes('Tidak ada jadwal upload lusa.'), 'third-day empty state');
        summary.querySelector('#yt-summary-next-day').click();
        assert(dates().join(',') === '2027-01-01,2027-01-02,2027-01-03', 'next navigation shifts all three days');
        assert(third().textContent.includes('2 HARI BERIKUTNYA') && third().textContent.includes('Channel One'), 'offset third-day label and schedule');
        third().querySelector('.yt-summary-cancel-btn').click(); await settle();
        assert(!channel.uploadSchedules['2027-01-03'], 'third-day cancel targets correct date');
        assert(channel.uploadSchedules['2026-12-31'] && channel.uploadSchedules['2027-01-01'], 'other dates preserved');
        summary.querySelector('#yt-summary-prev-day').click();
        assert(dates()[0] === '2026-12-31' && third().textContent.includes('LUSA'), 'previous navigation restores today');
        window._ytSummaryDayOffset = -1; renderYtUploadSummary(channels);
        assert(dates().join(',') === '2026-12-30,2026-12-31,2027-01-01', 'negative offset still shows three dates');
        renderYtUploadSummary([]);
        assert(summary.classList.contains('hidden'), 'no-channel state stays hidden');
        document.getElementById('result').textContent = 'PASS: ' + assertions + ' YouTube assertions';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error.stack; }
})();
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-schedule-test-'));
try {
    const fixture = path.join(temp, 'test.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><meta charset="utf-8"></head><body>
        <div id="yt-upload-summary"></div><pre id="result">RUNNING</pre>
        <script>${setup}\n${source}\n${tests}</script></body></html>`);
    const run = spawnSync(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--disable-background-networking', '--allow-file-access-from-files',
        '--user-data-dir=' + path.join(temp, 'profile'), '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(fixture).href
    ], { encoding:'utf8', timeout:45000, maxBuffer:5 * 1024 * 1024 });
    const result = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
    if (run.error || !result?.startsWith('PASS:')) throw new Error(result || run.error?.message || run.stderr);
    console.log(result);
    console.log('Firestore writes were mocked; responsive utility classes checked without loading Tailwind CDN.');
} finally {
    fs.rmSync(temp, { recursive:true, force:true, maxRetries:5, retryDelay:300 });
}