// monitor.js — WebSocket + HTTP Polling (Hybrid, ultra-stable)
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
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000", 10);
const POLL_MESSAGE_LIMIT = parseInt(process.env.POLL_MESSAGE_LIMIT || "20", 10);

// -------------------- NTFY --------------------
const NTFY_PRIMARY_URL = "https://ntfy.sh/sofi-wishes";
const NTFY_SECONDARY_URL = "https://ntfy.sh/mitsu-wishes";

// -------------------- STATE --------------------
const alertedState = new Map();
let lastNtfySendAt = 0;
const NTFY_MIN_GAP_MS = 1500;
let lastPollErrorAt = 0;

// -------------------- EXPRESS --------------------
const app = express();

app.get("/", (req, res) =>
    res.send("✅ Heart Monitor (Render keep-alive active)")
);

app.listen(PORT, () =>
    console.log(`🌐 Health endpoint listening on :${PORT}`)
);

// -------------------- RENDER KEEP-ALIVE --------------------
if (RENDER_EXTERNAL_URL) {
    setInterval(async () => {
        try {
            await axios.get(RENDER_EXTERNAL_URL, { timeout: 8000 });
        } catch (err) {
            console.error("⚠️ Render keep-alive ping failed:",
                err?.message || err
            );
        }
    }, 10 * 60 * 1000); // every 10 minutes
} else {
    console.warn("⚠️ RENDER_EXTERNAL_URL not set — keep-alive disabled");
}

// -------------------- HELPERS --------------------
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function safeParseIntFromLabel(label) {
    if (!label) return NaN;
    const s = String(label).replace(/[^0-9kKmM.]/g, "").trim().toLowerCase();
    if (!s) return NaN;
    if (s.endsWith("k")) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith("m")) return Math.round(parseFloat(s) * 1_000_000);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : NaN;
}

function extractHeartsFromMessage(msg) {
    try {
        const values = [];
        for (const row of msg.components || []) {
            for (const comp of row.components || []) {
                if (!comp.label) continue;
                const val = safeParseIntFromLabel(comp.label);
                if (!Number.isNaN(val)) values.push(val);
            }
        }
        return values;
    } catch {
        return [];
    }
}

// -------------------- NTFY --------------------
async function sendNtfy(url, value, priority = "5") {
    const delta = Date.now() - lastNtfySendAt;
    if (delta < NTFY_MIN_GAP_MS) await sleep(NTFY_MIN_GAP_MS - delta);
    try {
        await axios.post(url, `Value detected: ${value}`, {
            headers: { Title: "Heart Alert", Priority: priority }
        });
    } catch (err) {
        console.error("❌ ntfy error:", err?.message || err);
    }
    lastNtfySendAt = Date.now();
}

// -------------------- ALERT LOGIC --------------------
async function processHeartsFound(maxValue, messageId) {
    const now = Date.now();
    const state = alertedState.get(messageId) || {
        primaryAt: 0,
        secondaryAt: 0,
        lastValue: null
    };
    if (state.lastValue === maxValue) return;

    if (maxValue > 799 && !state.primaryAt) {
        await sendNtfy(NTFY_PRIMARY_URL, maxValue, "5");
        state.primaryAt = now;
    }

    if (maxValue > 100 && maxValue < 800 && !state.secondaryAt) {
        await sendNtfy(NTFY_SECONDARY_URL, maxValue, "3");
        state.secondaryAt = now;
    }

    state.lastValue = maxValue;
    alertedState.set(messageId, state);
}

// -------------------- DISCORD --------------------
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
    if (msg.channelId !== CHANNEL_ID) return;
    if (msg.author?.id !== GAME_BOT_ID) return;

    const hearts = extractHeartsFromMessage(msg);
    if (!hearts.length) return;

    await processHeartsFound(Math.max(...hearts), msg.id);
});

// -------------------- LOGIN LOOP --------------------
(async function loginLoop() {
    while (true) {
        try {
            await client.login(BOT_TOKEN);
            return;
        } catch {
            await sleep(5000);
        }
    }
})();

// -------------------- POLLING --------------------
setInterval(async () => {
    const url = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${POLL_MESSAGE_LIMIT}`;
    try {
        const res = await axios.get(url, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        for (const msg of res.data.filter(m => m.author?.id === GAME_BOT_ID)) {
            const hearts = extractHeartsFromMessage(msg);
            if (hearts.length) {
                await processHeartsFound(Math.max(...hearts), msg.id);
            }
        }
    } catch {}
}, POLL_INTERVAL);

// -------------------- SAFETY --------------------
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

console.log("🚀 Render hybrid monitor running (internal HTTP keep-alive enabled)");
