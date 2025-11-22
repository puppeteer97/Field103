// ==============================
// monitor.js — UptimeRobot-Compatible Version
// ==============================

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// --------- ENV VARS ------------
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GAME_BOT_ID = process.env.GAME_BOT_ID;
const PUSH_USER = process.env.PUSH_USER;
const PUSH_TOKEN = process.env.PUSH_TOKEN;

// Your Render public web URL for UptimeRobot to ping
const PUBLIC_URL = process.env.PUBLIC_URL;   // <-- add this in Render env

let lastAlertMessageId = null;
let lastAlertValue = null;

// -------------------------------------------
// EXPRESS SERVER (UptimeRobot will ping this)
// -------------------------------------------
app.get("/", (req, res) => {
    res.send("✅ Heart Monitor Running (UptimeRobot Compatible)");
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// -------------------------------------------
// OPTIONAL: PUBLIC SELF-PING (keeps Render awake)
// -------------------------------------------
if (PUBLIC_URL) {
    setInterval(() => {
        axios.get(PUBLIC_URL)
            .then(() => console.log("🔁 External self-ping OK"))
            .catch(() => console.log("⚠ External self-ping FAIL"));
    }, 4 * 60 * 1000); // 4 minutes
} else {
    console.log("⚠ PUBLIC_URL not set — only UptimeRobot will keep service alive");
}

// ==========================
// HEART MONITOR LOGIC BELOW
// ==========================

async function fetchLatestMessages() {
    try {
        const res = await axios.get(
            `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=20`,
            { headers: { Authorization: `Bot ${BOT_TOKEN}` } }
        );

        const messages = res.data;
        const botMsgs = messages.filter(msg => msg.author?.id === GAME_BOT_ID);

        return botMsgs.slice(0, 5);
    } catch (err) {
        console.error("❌ Failed to fetch messages:", err.response?.data || err);
        return [];
    }
}

function parseHeartLabel(label) {
    let val = label.toLowerCase().trim();
    if (val.endsWith("k")) return Math.round(parseFloat(val.replace("k", "")) * 1000);
    return parseInt(val, 10);
}

function extractHearts(msg) {
    if (!msg.components?.length) return [];
    const row = msg.components[0];
    if (!row.components) return [];
    return row.components
        .filter(btn => btn.emoji?.name === "❤️")
        .map(btn => parseHeartLabel(btn.label));
}

// ---------------------------
// Pushover alert
// ---------------------------
async function sendPushoverAlert(value, msgId) {
    try {
        await fetch("https://api.pushover.net/1/messages.json", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                token: PUSH_TOKEN,
                user: PUSH_USER,
                message: `🚨 ALERT: Heart value ${value} detected (above 150)\nMessage ID: ${msgId}`
            })
        });

        console.log(`📨 Pushover alert sent! (value ${value})`);
    } catch (err) {
        console.error("❌ Error sending Pushover:", err);
    }
}

// ---------------------------
// Main monitor loop
// ---------------------------
async function checkLoop() {
    console.log("\n🔄 Checking Discord…");

    const msgs = await fetchLatestMessages();
    if (!msgs.length) {
        console.log("⚠ No bot messages found.");
        return;
    }

    let highestValue = 0;
    let highestMsgId = null;

    for (const msg of msgs) {
        const extracted = extractHearts(msg);
        const msgMax = Math.max(...extracted);
        if (msgMax > highestValue) {
            highestValue = msgMax;
            highestMsgId = msg.id;
        }
    }

    console.log("❤️ Highest extracted heart:", highestValue);

    if (highestValue > 150) {

        if (highestMsgId === lastAlertMessageId && highestValue === lastAlertValue) {
            console.log("⏳ Alert suppressed — already sent for this message/value");
            return;
        }

        console.log(`🚨 High heart detected (${highestValue}) — sending alert…`);
        await sendPushoverAlert(highestValue, highestMsgId);

        lastAlertMessageId = highestMsgId;
        lastAlertValue = highestValue;
    } else {
        console.log("✅ All values ≤ 150");
    }
}

console.log("🚀 Heart Monitor started (checking every 5 seconds)...");
setInterval(checkLoop, 5000);
checkLoop();
