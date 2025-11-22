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
// FETCH UP TO 15 MESSAGES
// ------------------------------
// (We fetch 20 to be safe and then filter bot messages)
async function fetchLatestMessages() {
    try {
        const res = await axios.get(
            `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=20`,
            {
                headers: { Authorization: `Bot ${BOT_TOKEN}` }
            }
        );

        const messages = res.data;

        // Keep only messages sent by the bot
        const botMsgs = messages.filter(m => m.author?.id === GAME_BOT_ID);

        // ✔ return the most recent 5 bot messages
        return botMsgs.slice(0, 5);

    } catch (err) {
        console.error("❌ Failed to fetch messages:", err.response?.data || err);
        return [];
    }
}

// ------------------------------
// EXTRACT ❤️ VALUES FROM BUTTONS
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
                    "🚨 ALERT! One or more heart values are ABOVE 150.\n\nValues: " +
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
        console.log("⚠ No recent bot messages found.");
        return;
    }

    let allValues = [];

    for (const msg of msgs) {
        const values = extractHearts(msg);
        allValues = allValues.concat(values);
    }

    console.log("❤️ Extracted heart values:", allValues);

    // ✔ ALERT condition: ANY value > 150
    if (allValues.some(v => v > 150)) {
        await sendPushoverAlert(allValues);
    } else {
        console.log("✅ All values ≤ 150");
    }
}

// ------------------------------
// START LOOP
// ------------------------------
console.log("🚀 Heart Monitor running every 5 seconds…");
checkLoop();
setInterval(checkLoop, 5000);
