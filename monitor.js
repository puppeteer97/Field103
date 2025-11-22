require("dotenv").config();
const axios = require("axios");
const fetch = require("node-fetch");

// ------------------------------
// READ ENV VARIABLES FROM RENDER
// ------------------------------
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GAME_BOT_ID = process.env.GAME_BOT_ID;

const PUSH_USER = process.env.PUSH_USER;
const PUSH_TOKEN = process.env.PUSH_TOKEN;

// Validate environment variables
if (!CHANNEL_ID || !BOT_TOKEN || !GAME_BOT_ID || !PUSH_USER || !PUSH_TOKEN) {
    console.error("❌ Missing environment variables!");
    console.error("Please set CHANNEL_ID, BOT_TOKEN, GAME_BOT_ID, PUSH_USER, PUSH_TOKEN");
    process.exit(1);
}

// ------------------------------
// FETCH UP TO 10 MESSAGES
// ------------------------------
async function fetchLatestMessages() {
    try {
        const res = await axios.get(
            `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=10`,
            {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }
            }
        );

        const messages = res.data;

        const botMsgs = messages.filter(m => m.author?.id === GAME_BOT_ID);

        return botMsgs.slice(0, 3); // last 3 bot messages
    } catch (err) {
        console.error("❌ Failed to fetch messages:", err.response?.data || err);
        return [];
    }
}

// ------------------------------
// EXTRACT ❤️ HEART VALUES
// ------------------------------
function extractHearts(msg) {
    if (!msg.components?.length) return [];

    const row = msg.components[0];
    if (!row.components) return [];

    return row.components
        .filter(btn => btn.emoji?.name === "❤️")
        .map(btn => parseInt(btn.label, 10));
}

// ------------------------------
// SEND PUSHOVER ALERT
// ------------------------------
async function sendPushoverAlert(values) {
    try {
        await fetch("https://api.pushover.net/1/messages.json", {
            method: "POST",
            body: new URLSearchParams({
                token: PUSH_TOKEN,
                user: PUSH_USER,
                message:
                    "⚠ WARNING! One or more heart values dropped below 100.\n\nValues: " +
                    values.join(", ")
            })
        });

        console.log("📨 Pushover alert sent!");
    } catch (err) {
        console.error("❌ Pushover error:", err);
    }
}

// ------------------------------
// MAIN LOOP
// ------------------------------
async function checkLoop() {
    console.log("🔄 Checking Discord…");

    const msgs = await fetchLatestMessages();

    if (!msgs.length) {
        console.log("⚠ No bot messages found.");
        return;
    }

    let allValues = [];
    for (const msg of msgs) {
        const values = extractHearts(msg);
        allValues = allValues.concat(values);
    }

    console.log("❤️ Heart Values:", allValues);

    if (allValues.some(v => v < 100)) {
        await sendPushoverAlert(allValues);
    } else {
        console.log("✅ All values >= 100");
    }
}

// ------------------------------
console.log("🚀 Heart Monitor running every 5 seconds…");
checkLoop();
setInterval(checkLoop, 5000);
