// commands/general.js (MINIMAL TEST VERSION)
async function handleGeneralCommands(command, args, message, prefix) {
    console.log(`[GENERAL HANDLER REACHED] Received command: ${command}`);

    if (['bal', 'balance', 'b', 'profile'].includes(command)) {
        await message.reply('💰 Test Balance Command Works!');
        return true;
    }

    if (['ref', 'refer', 'referral'].includes(command)) {
        await message.reply('🤝 Test Referral Command Works!');
        return true;
    }

    if (command === 'link') {
        await message.reply('🔗 Test Link Command Works!');
        return true;
    }

    return false;
}

module.exports = { handleGeneralCommands };
