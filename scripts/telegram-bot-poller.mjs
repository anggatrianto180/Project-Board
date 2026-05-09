// Lightweight Telegram bot poller — no npm dependencies needed (uses built-in fetch)
// Checks for /jadwal command and outputs TRIGGERED=true if found

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not set.");
    process.exit(0);
}

async function sendReply(chatId, text) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
}

async function main() {
    try {
        // Fetch pending updates from Telegram
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
        const data = await res.json();

        if (!data.ok || !data.result || data.result.length === 0) {
            console.log("No new updates.");
            process.exit(0);
        }

        const now = Math.floor(Date.now() / 1000);
        let triggered = false;
        let triggerChatId = null;
        let maxUpdateId = 0;

        for (const update of data.result) {
            if (update.update_id > maxUpdateId) maxUpdateId = update.update_id;

            const msg = update.message;
            if (!msg || !msg.text) continue;

            const text = msg.text.toLowerCase().trim();
            const age = now - msg.date;

            // Only process messages from the last 10 minutes (600s) to avoid old replays
            if (age > 600) continue;

            if (text === '/jadwal' || text.startsWith('/jadwal ')) {
                triggered = true;
                triggerChatId = msg.chat.id;
                console.log(`Found /jadwal command from chat ${triggerChatId} (age: ${age}s)`);
            }
        }

        // Acknowledge ALL updates so they don't get re-processed
        if (maxUpdateId > 0) {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${maxUpdateId + 1}`);
            console.log(`Acknowledged updates up to ${maxUpdateId}`);
        }

        if (triggered) {
            // Send "checking..." reply
            await sendReply(triggerChatId || CHAT_ID, "⏳ _Sedang mengecek jadwal upload..._");

            // Signal to the workflow that we need to run the notifier
            const fs = await import('fs');
            const outputFile = process.env.GITHUB_OUTPUT;
            if (outputFile) {
                fs.appendFileSync(outputFile, `triggered=true\n`);
                fs.appendFileSync(outputFile, `chat_id=${triggerChatId || CHAT_ID}\n`);
            }
            console.log("TRIGGERED=true");
        } else {
            console.log("No /jadwal command found in recent messages.");
        }

        process.exit(0);
    } catch (error) {
        console.error("Error polling Telegram:", error);
        process.exit(0); // Don't fail the workflow
    }
}

main();
