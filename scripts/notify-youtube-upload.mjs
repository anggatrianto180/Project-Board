import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || "AIzaSyA8KJmXXX5ax3QulbDFKpBI87v36OLcvK0",
    authDomain: "project-management-fafb7.firebaseapp.com",
    projectId: "project-management-fafb7",
    storageBucket: "project-management-fafb7.firebasestorage.app",
    messagingSenderId: "935346350562",
    appId: "1:935346350562:web:a475abd4099b5acbd3b1bb"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FIREBASE_EMAIL = process.env.FIREBASE_EMAIL;
const FIREBASE_PASSWORD = process.env.FIREBASE_PASSWORD;

// ============================================================
// TABLE BUILDER HELPERS (ASCII box-drawing, monospace)
// Renders cleanly inside Telegram <pre> blocks (parse_mode HTML)
// ============================================================

/** Pad / truncate a string to exactly `len` chars */
function tgPad(str, len) {
    const s = String(str ?? '');
    if (s.length > len) return s.slice(0, len - 1) + '…';
    return s.padEnd(len);
}

const tgHrTop = (cols) => '┌' + cols.map(w => '─'.repeat(w)).join('┬') + '┐';
const tgHrMid = (cols) => '├' + cols.map(w => '─'.repeat(w)).join('┼') + '┤';
const tgHrBot = (cols) => '└' + cols.map(w => '─'.repeat(w)).join('┴') + '┘';
const tgRow  = (cells, cols) => '│' + cells.map((c, i) => tgPad(c, cols[i])).join('│') + '│';

/**
 * Build an upload schedule table for one day.
 * Returns an HTML string (with <b> header + <pre> table) or null if no pending items.
 */
function buildUploadTable(rows, label) {
    if (!rows || rows.length === 0) return null;

    // Cols: No(3) | Channel(22) | Status(8)
    const cols = [3, 22, 8];
    const lines = [];
    lines.push(tgHrTop(cols));
    lines.push(tgRow(['No', 'Channel', 'Status'], cols));
    lines.push(tgHrMid(cols));
    rows.forEach((r, i) => {
        lines.push(tgRow([String(i + 1), r.name, r.status], cols));
    });
    lines.push(tgHrBot(cols));

    return `📹 <b>Jadwal Upload — ${label}</b>\n<pre>${lines.join('\n')}</pre>`;
}

/**
 * Build a live schedule table for one day.
 * Returns an HTML string or null if no pending slots.
 */
function buildLiveTable(dayData, checkedSlots, label) {
    if (!dayData) return null;
    const slots = (dayData.slots || []).filter(slot => {
        const key = `${dayData.isoDate}_${slot.slotNumber}`;
        return !(checkedSlots && checkedSlots[key]);
    });
    if (slots.length === 0) return null;

    // Cols: #(3) | Video(18) | Tipe(9) | Mulai(6) | Selesai(6) | Durasi(7)
    const cols = [3, 18, 9, 6, 6, 7];
    const lines = [];
    lines.push(tgHrTop(cols));
    lines.push(tgRow(['#', 'Video', 'Tipe', 'Mulai', 'Slsai', 'Durasi'], cols));
    lines.push(tgHrMid(cols));
    slots.forEach(slot => {
        const tipe = slot.isPublic ? '🔴Public' : '🔒Unlstd';
        lines.push(tgRow([
            String(slot.slotNumber),
            slot.videoName,
            tipe,
            slot.startTimeWIB,
            slot.endTimeWIB,
            slot.durationText || '-'
        ], cols));
    });
    lines.push(tgHrBot(cols));

    const totalHours = dayData.totalHoursDecimal
        ? ` | Total: ${dayData.totalHoursDecimal} jam`
        : '';
    return `📡 <b>Jadwal Live — ${label}${totalHours}</b>\n<pre>${lines.join('\n')}</pre>`;
}

// ============================================================
// TELEGRAM SENDER (supports HTML parse_mode + auto-split)
// ============================================================

async function sendTelegramMessage(html) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn("Telegram credentials not provided. Skipping notification.");
        return;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    // Split into ≤4000-char chunks on newline boundaries
    const MAX = 4000;
    const chunks = [];
    let cur = '';
    for (const line of html.split('\n')) {
        if ((cur + '\n' + line).length > MAX) {
            if (cur) chunks.push(cur);
            cur = line;
        } else {
            cur = cur ? cur + '\n' + line : line;
        }
    }
    if (cur) chunks.push(cur);

    for (const chunk of chunks) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: chunk,
                    parse_mode: 'HTML'
                })
            });
            if (!response.ok) {
                console.error("Failed to send Telegram message:", await response.text());
            }
        } catch (error) {
            console.error("Error sending Telegram message:", error);
        }
    }
}

const ytChannelCollectionName = (tabId) => {
    const idNum = parseInt(tabId, 10);
    if (idNum === 1) return 'youtube_channels';
    return `youtube_channels_adsense_${idNum}`;
};

// ============================================================
// MAIN
// ============================================================

async function main() {
    try {
        if (FIREBASE_EMAIL && FIREBASE_PASSWORD) {
            console.log("Authenticating with Firebase...");
            await signInWithEmailAndPassword(auth, FIREBASE_EMAIL, FIREBASE_PASSWORD);
        }

        console.log("Fetching Adsense tabs config...");
        const configSnap = await getDoc(doc(db, 'config', 'youtube_adsense_tabs'));
        let tabs = [
            { id: 1, name: 'Adsense 1' },
            { id: 2, name: 'Adsense 2' },
            { id: 3, name: 'Adsense 3' },
            { id: 4, name: 'Adsense 4' }
        ];
        if (configSnap.exists() && configSnap.data().tabs && configSnap.data().tabs.length > 0) {
            tabs = configSnap.data().tabs;
        }

        // --- Calculate today & tomorrow in GMT+7 (Jakarta) ---
        const now = new Date();
        const jakartaOffset = 7 * 60 * 60 * 1000;

        const todayJakarta    = new Date(now.getTime() + jakartaOffset);
        const tomorrowJakarta = new Date(now.getTime() + jakartaOffset + (24 * 60 * 60 * 1000));

        const formatDate = (d) => {
            const y   = d.getUTCFullYear();
            const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        const formatDateLabel = (d) => {
            const days   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
            const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli',
                            'Agustus','September','Oktober','November','Desember'];
            return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        };

        const todayStr      = formatDate(todayJakarta);
        const tomorrowStr   = formatDate(tomorrowJakarta);
        const todayLabel    = formatDateLabel(todayJakarta);
        const tomorrowLabel = formatDateLabel(tomorrowJakarta);

        console.log(`Checking schedules — Hari ini: ${todayStr}, Besok: ${tomorrowStr}`);

        // ====================================================
        // SECTION 1: Jadwal Upload YouTube
        // ====================================================
        const todayRows    = [];
        const tomorrowRows = [];

        for (const tab of tabs) {
            const colName  = ytChannelCollectionName(tab.id);
            const snapshot = await getDocs(collection(db, colName));

            snapshot.forEach(docSnap => {
                const channel = docSnap.data();
                if (!channel.isCombinedAdsense) return;

                const name = channel.name || docSnap.id;

                // TODAY
                const hasTodaySchedule  = channel.uploadSchedules && channel.uploadSchedules[todayStr];
                const isTodayUploaded   = channel.uploads && channel.uploads[todayStr];
                const isTodayReady      = channel.readyVideos && channel.readyVideos[todayStr];
                if (hasTodaySchedule && !isTodayUploaded) {
                    todayRows.push({
                        name,
                        status: isTodayReady ? '✅ Ready' : '🎬 Belum'
                    });
                }

                // TOMORROW
                const hasTomorrowSchedule = channel.uploadSchedules && channel.uploadSchedules[tomorrowStr];
                const isTomorrowUploaded  = channel.uploads && channel.uploads[tomorrowStr];
                const isTomorrowReady     = channel.readyVideos && channel.readyVideos[tomorrowStr];
                if (hasTomorrowSchedule && !isTomorrowUploaded) {
                    tomorrowRows.push({
                        name,
                        status: isTomorrowReady ? '✅ Ready' : '🎬 Belum'
                    });
                }
            });
        }

        const uploadTodayMsg    = buildUploadTable(todayRows,    `📌 Hari Ini — ${todayLabel}`);
        const uploadTomorrowMsg = buildUploadTable(tomorrowRows, `⏰ Besok — ${tomorrowLabel}`);

        // ====================================================
        // SECTION 2: Jadwal Live YouTube
        // ====================================================
        console.log("Fetching YouTube Live schedule...");
        let liveTodayMsg    = null;
        let liveTomorrowMsg = null;

        try {
            const liveSnap = await getDoc(doc(db, 'yt_live_rotator', 'active_schedule'));
            if (liveSnap.exists()) {
                const liveData    = liveSnap.data();
                const schedule    = liveData.schedule    || [];
                const checkedSlots = liveData.checkedSlots || {};

                const todayDay    = schedule.find(day => day.isoDate === todayStr);
                const tomorrowDay = schedule.find(day => day.isoDate === tomorrowStr);

                liveTodayMsg    = buildLiveTable(todayDay,    checkedSlots, `📌 Hari Ini — ${todayLabel}`);
                liveTomorrowMsg = buildLiveTable(tomorrowDay, checkedSlots, `⏰ Besok — ${tomorrowLabel}`);
            } else {
                console.log("No live schedule found in Firestore.");
            }
        } catch (liveErr) {
            console.warn("Could not fetch live schedule:", liveErr.message);
        }

        // ====================================================
        // Combine into ONE message
        // ====================================================
        const hasUpload = uploadTodayMsg || uploadTomorrowMsg;
        const hasLive   = liveTodayMsg   || liveTomorrowMsg;

        if (!hasUpload && !hasLive) {
            console.log("No pending uploads or live slots for today or tomorrow.");
            process.exit(0);
            return;
        }

        // Timestamp header
        const tsWIB = new Date(now.getTime() + jakartaOffset)
            .toUTCString()
            .replace('GMT', 'WIB')
            .replace(/^\w+,\s/, '');

        const parts = [];
        parts.push(`🔔 <b>LAPORAN JADWAL YOUTUBE</b>\n<i>Otomatis — ${tsWIB}</i>`);

        // --- Upload block ---
        if (hasUpload) {
            parts.push('━━━━━━━━━━━━━━━━━━━');
            if (uploadTodayMsg)    parts.push(uploadTodayMsg);
            if (uploadTomorrowMsg) parts.push(uploadTomorrowMsg);
        }

        // --- Live block ---
        if (hasLive) {
            parts.push('━━━━━━━━━━━━━━━━━━━');
            if (liveTodayMsg)    parts.push(liveTodayMsg);
            if (liveTomorrowMsg) parts.push(liveTomorrowMsg);
        }

        const finalMessage = parts.join('\n\n');

        console.log("Sending combined notification...");
        await sendTelegramMessage(finalMessage);
        console.log("Notification sent successfully.");

        process.exit(0);
    } catch (error) {
        console.error("Error running schedule checker:", error);
        process.exit(1);
    }
}

main();
