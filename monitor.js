// monitor.js — WebSocket + HTTP Polling (Hybrid, ultra-stable)
// -----------------------------------------------------------------
// Requirements (in your project):
//  - "discord.js"
//  - "axios"
//  - "express"
//  - "dotenv"
// -----------------------------------------------------------------

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Client, GatewayIntentBits } = require("discord.js");

// -------------------- CONFIG --------------------
const PORT = process.env.PORT || 3000;
const CHANNEL_ID = process.env.CHANNEL_ID;   // channel to monitor
const BOT_TOKEN = process.env.BOT_TOKEN;     // bot token (must be bot token)
const GAME_BOT_ID = process.env.GAME_BOT_ID; // ID of the bot whose messages we watch
const PUSH_USER = process.env.PUSH_USER;     // Pushover user
const PUSH_TOKEN = process.env.PUSH_TOKEN;   // Pushover token

// polling interval (ms) — adjust if you want; default 5s
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000", 10);

// how many messages to fetch in polling fallback
const POLL_MESSAGE_LIMIT = parseInt(process.env.POLL_MESSAGE_LIMIT || "20", 10);

// -------------------- STATE --------------------
let lastAlertMessageId = null;
let lastAlertValue = null;
let lastPollErrorAt = 0;

// -------------------- EXPRESS (health endpoint) --------------------
const app = express();
app.get("/", (req, res) => res.send("✅ Heart Monitor (hybrid)"));
app.listen(PORT, () => console.log(`🌐 Health endpoint listening on :${PORT}`));

// -------------------- HELPERS --------------------
function safeParseIntFromLabel(label) {
    if (!label) return NaN;
    // remove emoji and whitespace, accept formats like "11", "11k", "`11`", "❤️11"
    const s = String(label).replace(/[^0-9kKmM.]/g, "").trim().toLowerCase();
    if (!s) return NaN;
    // support 1.2k, 1k, 12
    if (s.endsWith("k")) {
        const num = parseFloat(s.slice(0, -1));
        return Number.isFinite(num) ? Math.round(num * 1000) : NaN;
    }
    if (s.endsWith("m")) {
        const num = parseFloat(s.slice(0, -1));
        return Number.isFinite(num) ? Math.round(num * 1_000_000) : NaN;
    }
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
}

function extractHeartsFromMessage(msg) {
    // msg is Discord message object (gateway) or raw message JSON (from REST)
    // Message components can have multiple rows; collect all buttons
    try {
        const components = msg.components || [];
        const values = [];
        for (const row of components) {
            if (!row || !row.components) continue;
            for (const comp of row.components) {
                // only buttons with heart emoji (some bots use heart emoji)
                const isHeartEmoji = !!(comp.emoji && String(comp.emoji.name).includes("❤️"));
                // fallback: if label looks numeric, include it (some bots don't set emoji)
                const looksNumeric = !!(comp.label && /[0-9]/.test(comp.label));
                if (!isHeartEmoji && !looksNumeric) continue;
                const val = safeParseIntFromLabel(comp.label);
                if (!Number.isNaN(val)) values.push(val);
            }
        }
        return values;
    } catch (err) {
        console.error("extractHeartsFromMessage error:", err);
        return [];
    }
}

// -------------------- Pushover --------------------
async function sendPushoverAlert(value, messageId, excerpt = "") {
    if (!PUSH_TOKEN || !PUSH_USER) {
        console.log("⚠ Pushover creds not set — skipping push alert");
        return;
    }

    try {
        const payload = new URLSearchParams({
            token: PUSH_TOKEN,
            user: PUSH_USER,
            message: `🚨 ALERT: Heart value ${value} detected (>${150})\nMessage ID: ${messageId}${excerpt ? `\n\n${excerpt}` : ""}`
        });

        const res = await axios.post("https://api.pushover.net/1/messages.json", payload.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 10000
        });

        console.log("📨 Pushover status:", res.status);
    } catch (err) {
        console.error("❌ Pushover send error:", err?.response?.data || err.message || err);
    }
}

// -------------------- PROCESS ALERT LOGIC --------------------
async function processHeartsFound(maxValue, messageId, excerpt = "") {
    try {
        if (maxValue <= 150) {
            // nothing to do
            return;
        }

        if (messageId === lastAlertMessageId && maxValue === lastAlertValue) {
            console.log("⏳ Suppressing duplicate alert for same message/value");
            return;
        }

        console.log(`🚨 High heart detected: ${maxValue} (message ${messageId}) — sending alert`);
        await sendPushoverAlert(maxValue, messageId, excerpt);

        lastAlertMessageId = messageId;
        lastAlertValue = maxValue;
    } catch (err) {
        console.error("processHeartsFound error:", err);
    }
}

// -------------------- DISCORD CLIENT (Gateway) --------------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    makeCache: undefined // use default caching
});

client.once("ready", () => {
    console.log(`🤖 Logged in as ${client.user.tag} — Gateway connected`);
});

// shard and lifecycle logs
client.on("shardDisconnect", (event, shardId) => console.warn("⚠ shardDisconnect", shardId, event));
client.on("shardReconnecting", (shardId) => console.log("♻ shardReconnecting", shardId));
client.on("shardResume", (shardId) => console.log("🔁 shardResume", shardId));

// message handler (primary real-time detector)
client.on("messageCreate", async (msg) => {
    try {
        if (!msg) return;
        if (msg.channelId !== CHANNEL_ID) return;
        if (!msg.author || msg.author.id !== GAME_BOT_ID) return;

        const hearts = extractHeartsFromMessage(msg);
        if (!hearts.length) return;

        const maxVal = Math.max(...hearts);
        console.log(`(gateway) ❤️ Detected ${maxVal} in message ${msg.id}`);
        await processHeartsFound(maxVal, msg.id, msg.content ? msg.content.slice(0, 400) : "");
    } catch (err) {
        console.error("messageCreate handler error:", err);
    }
});

// login and reconnect handling
(async () => {
    try {
        await client.login(BOT_TOKEN);
    } catch (err) {
        console.error("Failed to login Discord client:", err);
        // if login fails, keep process alive and keep trying every 30s
        setTimeout(() => process.exit(1), 60000);
    }
})();

// -------------------- HTTP POLLING (fallback) --------------------
async function fetchLatestBotMessagesViaREST(limit = POLL_MESSAGE_LIMIT) {
    if (!CHANNEL_ID || !BOT_TOKEN) return [];
    try {
        const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
        const res = await axios.get(url, {
            headers: {
                Authorization: `Bot ${BOT_TOKEN}`
            },
            timeout: 10000
        });
        // res.data is an array of message objects (raw)
        const msgs = Array.isArray(res.data) ? res.data : [];
        // filter only messages from the game bot
        return msgs.filter(m => m.author && m.author.id === GAME_BOT_ID);
    } catch (err) {
        const now = Date.now();
        // log but rate-limit our error logging so it doesn't spam
        if (now - lastPollErrorAt > 30_000) {
            console.error("fetchLatestBotMessagesViaREST error:", err?.response?.data || err.message || err);
            lastPollErrorAt = now;
        }
        return [];
    }
}

async function pollingLoop() {
    try {
        const msgs = await fetchLatestBotMessagesViaREST();
        if (!msgs || !msgs.length) {
            // nothing found — no problem, gateway will handle most cases
            return;
        }

        // check the newest few messages for heart labels
        for (const msg of msgs.slice(0, 5)) {
            const hearts = extractHeartsFromMessage(msg);
            if (!hearts.length) continue;
            const maxVal = Math.max(...hearts);
            console.log(`(poll) ❤️ Detected ${maxVal} in message ${msg.id}`);
            await processHeartsFound(maxVal, msg.id, msg.content ? msg.content.slice(0, 400) : "");
        }
    } catch (err) {
        console.error("pollingLoop error:", err);
    }
}

// start polling interval (hybrid mode)
setInterval(pollingLoop, POLL_INTERVAL);
console.log(`⏱ Polling loop started (every ${POLL_INTERVAL} ms). Gateway + HTTP hybrid active.`);

// -------------------- GRACEFUL ERRORS & LOGGING --------------------
process.on("unhandledRejection", (reason, p) => {
    console.error("Unhandled Rejection at:", p, "reason:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Do not exit — keep process alive; log and continue
});

// Final info
console.log("🚀 Hybrid Heart Monitor initialized. Gateway connected when bot token valid.");
