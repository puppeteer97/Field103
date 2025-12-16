// monitor.js — WebSocket + HTTP Polling (Hybrid, ultra-stable)
// -----------------------------------------------------------------
// Requirements:
//  - discord.js (v14)
//  - axios
//  - express
//  - dotenv
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

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000", 10);
const POLL_MESSAGE_LIMIT = parseInt(process.env.POLL_MESSAGE_LIMIT || "20", 10);

// -------------------- NTFY --------------------
const NTFY_PRIMARY_URL = "https://ntfy.sh/puppeteer-sofi";
const NTFY_SECONDARY_URL = "https://ntfy.sh/puppeteer-mitsu";

// -------------------- STATE --------------------
const alertedMessages = new Map();          // primary user suppression
const alertedMessagesSecond = new Map();   // secondary user suppression
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
        const n = parseFloat(s.slice(0, -1));
        return Number.isFinite(n) ? Math.round(n * 1000) : NaN;
    }
    if (s.endsWith("m")) {
        const n = parseFloat(s.slice(0, -1));
        return Number.isFinite(n) ? Math.round(n * 1_000_000) : NaN;
    }

    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
}

function extractHeartsFromMessage(msg) {
    try {
        const components = msg.components || [];
        const values = [];

        for (const row of components) {
            if (!row?.components) continue;
            for (const comp of row.components) {
                const hasHeart = comp.emoji && String(comp.emoji.name).includes("❤️");
                const looksNumeric = comp.label && /[0-9]/.test(comp.label);
                if (!hasHeart && !looksNumeric) continue;

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

// -------------------- NTFY SENDERS (REPLACES PUSHOVER) --------------------
async function sendNtfy(url, value) {
    try {
        await axios.post(url, `Value detected: ${value}`, {
            headers: {
                "Title": "Heart Alert",
                "Priority": "5"
            },
            timeout: 10000
        });
    } catch (err) {
        console.error("❌ ntfy error:", err?.message || err);
    }
}

// -------------------- PROCESS ALERT LOGIC --------------------
async function processHeartsFound(maxValue, messageId) {
    try {
        // ---------- PRIMARY (>300) ----------
        if (maxValue > 300) {
            const prev = alertedMessages.get(messageId);
            if (prev !== maxValue) {
                console.log(`🚨 PRIMARY alert ${maxValue} (msg ${messageId})`);
                await sendNtfy(NTFY_PRIMARY_URL, maxValue);

                alertedMessages.set(messageId, maxValue);
                if (alertedMessages.size > 200) {
                    alertedMessages.delete(alertedMessages.keys().next().value);
                }
            } else {
                console.log(`⏳ PRIMARY suppressed (${maxValue})`);
            }
        }

        // ---------- SECONDARY (100–600) ----------
        if (maxValue > 100 && maxValue < 600) {
            const prev2 = alertedMessagesSecond.get(messageId);
            if (prev2 !== maxValue) {
                console.log(`🔔 SECONDARY alert ${maxValue} (msg ${messageId})`);
                await sendNtfy(NTFY_SECONDARY_URL, maxValue);

                alertedMessagesSecond.set(messageId, maxValue);
                if (alertedMessagesSecond.size > 200) {
                    alertedMessagesSecond.delete(alertedMessagesSecond.keys().next().value);
                }
            } else {
                console.log(`⏳ SECONDARY suppressed (${maxValue})`);
            }
        }
    } catch (err) {
        console.error("processHeartsFound error:", err);
    }
}

// -------------------- DISCORD CLIENT --------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", () =>
    console.log(`🤖 Logged in as ${client.user.tag}`)
);

client.on("messageCreate", async (msg) => {
    try {
        if (
            msg.channelId !== CHANNEL_ID ||
            msg.author?.id !== GAME_BOT_ID
        ) return;

        const hearts = extractHeartsFromMessage(msg);
        if (!hearts.length) return;

        const maxVal = Math.max(...hearts);
        console.log(`(gateway) ❤️ ${maxVal}`);
        await processHeartsFound(maxVal, msg.id);
    } catch (err) {
        console.error("messageCreate error:", err);
    }
});

// -------------------- LOGIN LOOP --------------------
async function startClientLogin() {
    while (true) {
        try {
            await client.login(BOT_TOKEN);
            console.log("🔐 Discord login successful");
            return;
        } catch (err) {
            console.error("❌ Login failed, retrying...", err?.message || err);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}
startClientLogin();

// -------------------- HTTP POLLING --------------------
async function fetchLatestBotMessagesViaREST(limit = POLL_MESSAGE_LIMIT) {
    try {
        const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`;
        const res = await axios.get(url, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            timeout: 10000
        });
        return res.data.filter(m => m.author?.id === GAME_BOT_ID);
    } catch (err) {
        const now = Date.now();
        if (now - lastPollErrorAt > 30_000) {
            console.error("REST poll error:", err?.message || err);
            lastPollErrorAt = now;
        }
        return [];
    }
}

async function pollingLoop() {
    const msgs = await fetchLatestBotMessagesViaREST();
    for (const msg of msgs.slice(0, 5)) {
        const hearts = extractHeartsFromMessage(msg);
        if (!hearts.length) continue;

        const maxVal = Math.max(...hearts);
        console.log(`(poll) ❤️ ${maxVal}`);
        await processHeartsFound(maxVal, msg.id);
    }
}

setInterval(pollingLoop, POLL_INTERVAL);

// -------------------- SAFETY --------------------
process.on("unhandledRejection", err =>
    console.error("Unhandled Rejection:", err)
);
process.on("uncaughtException", err =>
    console.error("Uncaught Exception:", err)
);

console.log("🚀 Hybrid Heart Monitor initialized");
