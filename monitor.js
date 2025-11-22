// ==============================
// monitor.js  (COMBINED VERSION)
// ==============================

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

// --------- ENV VARS ------------
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GAME_BOT_ID = process.env.GAME_BOT_ID;   // bot sending heart buttons
const PUSH_USER = process.env.PUSH_USER;
const PUSH_TOKEN = process.env.PUSH_TOKEN;

// Validate env vars
if (!CHANNEL_ID || !BOT_TOKEN || !GAME_BOT_ID || !PUSH_USER || !PUSH_TOKEN) {
    console.error("❌ Missing environment variables!");
    process.exit(1);
}

// -------------------------------------------
// EXPRESS KEEP-ALIVE WEB SERVER FOR RENDER
// -------------------------------------------
app.get("/", (req, res) => {
    res.send("✅ Heart Monitor Running (Render Keep-Alive Active)");
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ==========================
// HEART MONITOR LOGIC BELOW
// ==========================

// Fetch the latest Discord messages from the channel
async function fetchLatestMessages() {
    try {
        const res = await axios.get(
            `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=20`,
            { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
        );

        const messages = res.data;

        // Filter only messages from the game bot
        const botMsgs = messages.filter(msg => msg.author?.id === GAME_BOT_ID);

        return botMsgs.slice(0, 5);  // Only last 5
    } catch (err) {
        console.error("❌ Failed to fetch messages:", err.response?.data || err);
        return [];
    }
}

// Extract numbers next to the ❤️ emoji buttons
function extractHearts(msg) {
    if (!msg.components?.length) return [];

    const row = msg.components[0];
    if (!row.components) return [];

    return row.components
        .filter(btn => btn.emoji?.name === "❤️")
        .map(btn => parseInt(btn.label, 10));
}

// Push notification (Pushover)
async function sendPushoverAlert(values) {
    try {
        await fetch("https://api.pushover.net/1/messages.json", {
            method: "POST",
            body: new URLSearchParams({
                token: PUSH_TOKEN,
                user: PUSH_USER,
                message:
                    "🚨 ALERT: A heart value is ABOVE 150!\n\nValues: " +
                    values.join(", ")
            })
        });

        console.log("📨 Pushover alert sent!");
    } catch (err) {
        console.error("❌ Error sending Pushover:", err);
    }
}

// Main monitoring loop
async function checkLoop() {
    console.log("\n🔄 Checking Discord…");

    const msgs = await fetchLatestMessages();
    if (!msgs.length) {
        console.log("⚠ No bot messages found.");
        return;
    }

    let allValues = [];

    for (const msg of msgs) {
        const extracted = extractHearts(msg);
        allValues.push(...extracted);
    }

    console.log("❤️ Extracted heart values:", allValues);

    // Trigger condition: ANY value > 150
    if (allValues.some(v => v > 150)) {
        console.log("🚨 High heart detected — sending alert…");
        await sendPushoverAlert(allValues);
    } else {
        console.log("✅ All values ≤ 150");
    }
}

// Run every 5 seconds
console.log("🚀 Heart Monitor started (checking every 5 seconds)...");
setInterval(checkLoop, 5000);
checkLoop();
