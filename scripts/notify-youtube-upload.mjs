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

        const now = new Date();
        // Convert to GMT+7 (Jakarta) by adding 7 hours to UTC, then add 24 hours for tomorrow
        const tomorrowJakarta = new Date(now.getTime() + (7 * 60 * 60 * 1000) + (24 * 60 * 60 * 1000));
        
        const yyyy = tomorrowJakarta.getUTCFullYear();
        const mm = String(tomorrowJakarta.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(tomorrowJakarta.getUTCDate()).padStart(2, '0');
        const tomorrowStr = `${yyyy}-${mm}-${dd}`;
        
        console.log(`Checking upload schedules for tomorrow: ${tomorrowStr}`);

        let notificationMessages = [];

        for (const tab of tabs) {
            const colName = ytChannelCollectionName(tab.id);
            const snapshot = await getDocs(collection(db, colName));
            
            snapshot.forEach(docSnap => {
                const channel = docSnap.data();
                
                // Only process channels in "adsense gabungan"
                if (channel.isCombinedAdsense) {
                    const hasSchedule = channel.uploadSchedules && channel.uploadSchedules[tomorrowStr];
                    const isUploaded = channel.uploads && channel.uploads[tomorrowStr];
                    const isReady = channel.readyVideos && channel.readyVideos[tomorrowStr];
                    
                    if (hasSchedule && !isUploaded) {
                        const statusStr = isReady ? "Tinggal upload" : "Perlu dibuat video dan upload";
                        notificationMessages.push(`- *${channel.name || docSnap.id}*: ${statusStr}`);
                    }
                }
            });
        }

        if (notificationMessages.length > 0) {
            const finalMessage = `🔔 *Pengingat Jadwal Upload YouTube (H-1)*\nTanggal: ${tomorrowStr}\n\n${notificationMessages.join('\n')}`;
            console.log("Sending notifications...");
            await sendTelegramMessage(finalMessage);
            console.log("Notifications sent successfully.");
        } else {
            console.log("No pending uploads for tomorrow in combined adsense channels.");
        }

        process.exit(0);
    } catch (error) {
        console.error("Error running schedule checker:", error);
        process.exit(1);
    }
}

main();
