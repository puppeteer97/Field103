// monitor.js — WebSocket + HTTP Polling (Hybrid, ultra-stable)
// -----------------------------------------------------------------
// Requirements (in your project):
//  - "discord.js" (v14)
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
const CHANNEL_ID = process.env.CHANNEL_ID;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GAME_BOT_ID = process.env.GAME_BOT_ID;

const PUSH_USER = process.env.PUSH_USER;         // original alert user
const PUSH_TOKEN = process.env.PUSH_TOKEN;

const SECOND_PUSH_USER = process.env.SECOND_PUSH_USER;   // NEW
const SECOND_PUSH_TOKEN = process.env.SECOND_PUSH_TOKEN; // NEW

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000", 10);
const POLL_MESSAGE_LIMIT = parseInt(process.env.POLL_MESSAGE_LIMIT || "20", 10);

// -------------------- STATE --------------------
const alertedMessages = new Map();
let lastPollErrorAt = 0;

// -------------------- EXPRESS --------------------
const app = express();
app.get("/", (req, res) => res.send("✅ Heart Monitor (hybrid)"));
app.listen(PORT, () => console.log(`🌐 Health endpoint listening on :${PORT}`));

// -------------------- HELPERS --------------------
function safeParseIntFromLabel(label) {
    if (!label) return NaN;
    const s = String(label).replace(/[^0-9kKmM.]/g, "").trim().toLowerCase();
    if (!s) return NaN;
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
    try {
        const components = msg.components || [];
        const values = [];
        for (const row of components) {
            if (!row || !row.components) continue;
            for (const comp of row.components) {
                const isHeartEmoji = !!(comp.emoji && String(comp.emoji.name).includes("❤️"));
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
async function sendPushoverAlert(user, token, value) {
    if (!user || !token) {
        console.log("⚠ Missing Pushover creds — skipping alert");
        return;
    }

    try {
        const payload = new URLSearchParams({
            token,
            user,
            message: `Value detected: ${value}`
        });

        const res = await axios.post(
            "https://api.pushover.net/1/messages.json",
            payload.toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                timeout: 10000
            }
        );

        console.log("📨 Pushover status:", res.status);
    } catch (err) {
        console.error("❌ Pushover send error:", err?.response?.data || err.message || err);
    }
}

// -------------------- PROCESS ALERT LOGIC --------------------
async function processHeartsFound(maxValue, messageId, excerpt = "") {
    try {
        // ------------------------------------------------------
        // ORIGINAL RULE: alert when >250  → send to main user
        // ------------------------------------------------------
        if (maxValue > 250) {
            const previous = alertedMessages.get(messageId);
            if (previous && previous === maxValue) {
                console.log(`⏳ Suppressing repeat alert for message ${messageId} (value ${maxValue})`);
                return;
            }

            console.log(`🚨 High heart detected: ${maxValue} (message ${messageId}) — sending alert`);
            await sendPushoverAlert(PUSH_USER, PUSH_TOKEN, maxValue);

            alertedMessages.set(messageId, maxValue);
            if (alertedMessages.size > 200) {
                const oldest = alertedMessages.keys().next().value;
                alertedMessages.delete(oldest);
            }
        }

        // ------------------------------------------------------
        // NEW RULE: send alert to second user if 100 < value < 400
        // ------------------------------------------------------
        if (maxValue > 100 && maxValue < 400) {
            console.log(
                `🔔 Mid-range value ${maxValue} detected — sending SECONDARY alert`
            );
            await sendPushoverAlert(SECOND_PUSH_USER, SECOND_PUSH_TOKEN, maxValue);
        }

    } catch (err) {
        console.error("processHeartsFound error:", err);
    }
}

// -------------------- DISCORD CLIENT (Gateway) --------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", () => {
    try {
        console.log(`🤖 Logged in as ${client.user.tag} — Gateway connected`);
    } catch (err) {
        console.log("🤖 Logged in (failed to read tag):", err);
    }
});

// Events
client.on("shardDisconnect", (event, shardId) => console.warn("⚠ shardDisconnect", shardId, event));
client.on("shardReconnecting", (shardId) => console.log("♻ shardReconnecting", shardId));
client.on("shardResume", (shardId) => console.log("🔁 shardResume", shardId));

// message handler
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

// -------------------- LOGIN RETRY LOOP --------------------
let loginAttempts = 0;
async function startClientLogin() {
    while (true) {
        try {
            loginAttempts++;
            console.log(`🔑 Attempting Discord login (attempt ${loginAttempts})`);
            await client.login(BOT_TOKEN);
            console.log("🔐 Discord login successful");
            return;
        } catch (err) {
            console.error("❌ Discord login failed:", err?.message || err);
            const backoffMs = Math.min(60_000, 2000 * Math.pow(2, Math.min(loginAttempts - 1, 6)));
            console.log(`⏳ Retrying login in ${backoffMs / 1000}s`);
            await new Promise(res => setTimeout(res, backoffMs));
        }
    }
}
startClientLogin().catch(err => {
    console.error("Fatal login loop error:", err);
});

// -------------------- HTTP POLLING --------------------
async function fetchLatestBotMessagesViaREST(limit = POLL_MESSAGE_LIMIT) {
    if (!CHANNEL_ID || !BOT_TOKEN) return [];
    try {
        const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
        const res = await axios.get(url, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            timeout: 10000
        });

        const msgs = Array.isArray(res.data) ? res.data : [];
        return msgs.filter(m => m.author && m.author.id === GAME_BOT_ID);

    } catch (err) {
        const now = Date.now();
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
        if (!msgs || !msgs.length) return;

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

setInterval(pollingLoop, POLL_INTERVAL);
console.log(`⏱ Polling loop started (every ${POLL_INTERVAL} ms). Gateway + HTTP hybrid active.`);

// -------------------- ERROR HANDLING --------------------
process.on("unhandledRejection", (reason, p) => {
    console.error("Unhandled Rejection at:", p, "reason:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
});

// Final info
console.log("🚀 Hybrid Heart Monitor initialized. Gateway will connect when bot token is valid.");
