async function checkLoop() {
    console.log("\n🔄 Checking Discord…");

    const msgs = await fetchLatestMessages();
    if (!msgs.length) {
        console.log("⚠ No bot messages found.");
        return;
    }

    let allValues = [];
    let highestValue = 0;
    let highestMsgId = null;

    for (const msg of msgs) {
        const extracted = extractHearts(msg);
        allValues.push(...extracted);

        const msgMax = Math.max(...extracted);

        if (msgMax > highestValue) {
            highestValue = msgMax;
            highestMsgId = msg.id;
        }
    }

    console.log("❤️ Extracted heart values:", allValues);

    // -------- ALERT ONLY ON SINGLE VALUE --------
    if (highestValue > 150) {

        // Prevent duplicate notifications
        if (lastAlertMessageId === highestMsgId && lastAlertValue === highestValue) {
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
