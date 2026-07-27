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

async function sendTelegramMessage(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.warn("Telegram credentials not provided. Skipping notification:", message);
        return;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
        if (!response.ok) {
            console.error("Failed to send Telegram message:", await response.text());
        }
    } catch (error) {
        console.error("Error sending Telegram message:", error);
    }
}

const ytChannelCollectionName = (tabId) => {
    const idNum = parseInt(tabId, 10);
    if (idNum === 1) return 'youtube_channels';
    return `youtube_channels_adsense_${idNum}`;
};

// --- Build live schedule section for a given day ---
// Only includes slots that have NOT been checked (unchecked = belum dijadwalkan)
function buildLiveSection(dayData, checkedSlots, label, emoji) {
    if (!dayData) return null;
    const slots = dayData.slots || [];
    if (slots.length === 0) return null;

    const lines = [];
    for (const slot of slots) {
        const key = `${dayData.isoDate}_${slot.slotNumber}`;
        const isDone = checkedSlots && checkedSlots[key];
        // Skip slots that are already checked (sudah dijadwalkan)
        if (isDone) continue;
        const typeLabel = slot.isPublic ? '🔴 Public' : '🔒 Unlisted';
        lines.push(`  ⬜ ${typeLabel} | ${slot.startTimeWIB} → ${slot.endTimeWIB} | *${slot.videoName}* (${slot.durationText})`);
    }

    // If all slots are already done, skip this day entirely
    if (lines.length === 0) return null;

    const totalHours = dayData.totalHoursDecimal ? `${dayData.totalHoursDecimal} jam total` : '';
    const header = `${emoji} *LIVE ${label} — ${dayData.dateLabel}*${totalHours ? ` _(${totalHours})_` : ''}`;
    return `${header}\n${lines.join('\n')}`;
}

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
        const jakartaOffset = 7 * 60 * 60 * 1000; // +7 hours in ms

        const todayJakarta = new Date(now.getTime() + jakartaOffset);
        const tomorrowJakarta = new Date(now.getTime() + jakartaOffset + (24 * 60 * 60 * 1000));

        const formatDate = (d) => {
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        const formatDateLabel = (d) => {
            const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
            const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
            return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        };

        const todayStr = formatDate(todayJakarta);
        const tomorrowStr = formatDate(tomorrowJakarta);
        const todayLabel = formatDateLabel(todayJakarta);
        const tomorrowLabel = formatDateLabel(tomorrowJakarta);

        console.log(`Checking schedules — Hari ini: ${todayStr}, Besok: ${tomorrowStr}`);

        // ====================================================
        // SECTION 1: Jadwal Upload YouTube
        // ====================================================
        let todayMessages = [];
        let tomorrowMessages = [];

        for (const tab of tabs) {
            const colName = ytChannelCollectionName(tab.id);
            const snapshot = await getDocs(collection(db, colName));

            snapshot.forEach(docSnap => {
                const channel = docSnap.data();

                // Only process channels in "adsense gabungan"
                if (!channel.isCombinedAdsense) return;

                // Check TODAY
                const hasTodaySchedule = channel.uploadSchedules && channel.uploadSchedules[todayStr];
                const isTodayUploaded = channel.uploads && channel.uploads[todayStr];
                const isTodayReady = channel.readyVideos && channel.readyVideos[todayStr];

                if (hasTodaySchedule && !isTodayUploaded) {
                    const status = isTodayReady
                        ? "✅ Video sudah ready — tinggal upload"
                        : "🎬 Perlu dibuat video dan upload";
                    todayMessages.push(`  • *${channel.name || docSnap.id}* — ${status}`);
                }

                // Check TOMORROW
                const hasTomorrowSchedule = channel.uploadSchedules && channel.uploadSchedules[tomorrowStr];
                const isTomorrowUploaded = channel.uploads && channel.uploads[tomorrowStr];
                const isTomorrowReady = channel.readyVideos && channel.readyVideos[tomorrowStr];

                if (hasTomorrowSchedule && !isTomorrowUploaded) {
                    const status = isTomorrowReady
                        ? "✅ Video sudah ready — tinggal upload"
                        : "🎬 Perlu dibuat video dan upload";
                    tomorrowMessages.push(`  • *${channel.name || docSnap.id}* — ${status}`);
                }
            });
        }

        // Build upload sections
        let uploadSections = [];
        if (todayMessages.length > 0) {
            uploadSections.push(`📌 *HARI INI — ${todayLabel}*\n${todayMessages.join('\n')}`);
        }
        if (tomorrowMessages.length > 0) {
            uploadSections.push(`⏰ *BESOK — ${tomorrowLabel}*\n${tomorrowMessages.join('\n')}`);
        }

        // ====================================================
        // SECTION 2: Jadwal Live YouTube
        // ====================================================
        console.log("Fetching YouTube Live schedule...");
        let liveSections = [];

        try {
            const liveSnap = await getDoc(doc(db, 'yt_live_rotator', 'active_schedule'));
            if (liveSnap.exists()) {
                const liveData = liveSnap.data();
                const schedule = liveData.schedule || [];
                const checkedSlots = liveData.checkedSlots || {};

                // Find today's and tomorrow's day entries
                const todayDay = schedule.find(day => day.isoDate === todayStr);
                const tomorrowDay = schedule.find(day => day.isoDate === tomorrowStr);

                const todayLiveSection = buildLiveSection(todayDay, checkedSlots, 'HARI INI', '📌');
                const tomorrowLiveSection = buildLiveSection(tomorrowDay, checkedSlots, 'BESOK', '⏰');

                if (todayLiveSection) liveSections.push(todayLiveSection);
                if (tomorrowLiveSection) liveSections.push(tomorrowLiveSection);
            } else {
                console.log("No live schedule found in Firestore.");
            }
        } catch (liveErr) {
            console.warn("Could not fetch live schedule:", liveErr.message);
        }

        // ====================================================
        // Combine into ONE message
        // ====================================================
        const hasUpload = uploadSections.length > 0;
        const hasLive = liveSections.length > 0;

        if (!hasUpload && !hasLive) {
            console.log("No pending uploads or live slots for today or tomorrow.");
            process.exit(0);
            return;
        }

        let messageParts = [];

        // --- Upload block ---
        if (hasUpload) {
            messageParts.push(`📹 *Jadwal Upload YouTube*\n\n${uploadSections.join('\n\n')}`);
        }

        // --- Live block ---
        if (hasLive) {
            messageParts.push(`📡 *Jadwal Live YouTube*\n\n${liveSections.join('\n\n')}`);
        }

        const finalMessage = messageParts.join('\n\n━━━━━━━━━━━━━━━━\n\n');

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
