const express = require('express');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Helper function to safely load required modules without crashing
function safeRequire(filePath) {
    try {
        return require(filePath);
    } catch (err) {
        console.error(`❌ FAILED TO LOAD MODULE (${filePath}):`, err.message);
        return {};
    }
}

// Import Command Handlers
const { handleAdminCommands } = safeRequire('./commands/admin');
const { handleBankingCommands } = safeRequire('./commands/banking');
const { handleGameCommands } = safeRequire('./commands/games');
const { handleGeneralCommands } = safeRequire('./commands/general');
const { handleInteractions } = safeRequire('./handlers/interactions');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

// Keep-Alive Self Ping
setInterval(() => {
    http.get(`http://localhost:${PORT}`).on('error', () => {});
}, 5 * 60 * 1000);

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

// Environment Variable Guard Checks
if (!process.env.DISCORD_TOKEN) console.error('⚠️ WARNING: DISCORD_TOKEN is missing!');
if (!process.env.ADMIN_DISCORD_ID) console.error('⚠️ WARNING: ADMIN_DISCORD_ID is missing!');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

const ALLOWED_PREFIXES = ['!', '$', '/', '.'];

client.once('ready', () => {
    console.log(`🤖 SUCCESS: Bot is online as ${client.user.tag}!`);
});

client.on('error', (err) => console.error('❌ Discord Client Error:', err));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    console.log(`📩 Received command "${message.content}" from ${message.author.tag}`);

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        let handled = false;

        if (handleAdminCommands) handled = await handleAdminCommands(command, args, message, prefix);
        if (!handled && handleBankingCommands) handled = await handleBankingCommands(command, args, message, prefix);
        if (!handled && handleGameCommands) handled = await handleGameCommands(command, args, message, prefix);
        if (!handled && handleGeneralCommands) handled = await handleGeneralCommands(command, args, message, prefix);

        if (!handled) {
            console.log(`⚠️ Unrecognized command: "${command}"`);
        }
    } catch (err) {
        console.error(`❌ Error executing command '${command}':`, err);
        message.reply('❌ An internal error occurred while processing that command.').catch(() => {});
    }
});

client.on('interactionCreate', async (interaction) => {
    if (handleInteractions) {
        try {
            await handleInteractions(interaction, client);
        } catch (err) {
            console.error('❌ Interaction Error:', err);
        }
    }
});

// Discord Authentication
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD LOGIN SKIPPED: Missing DISCORD_TOKEN environment variable.');
} else {
    console.log('Initiating connection to Discord...');
    client.login(process.env.DISCORD_TOKEN)
        .then(() => console.log('✅ Connected to Discord Gateway successfully!'))
        .catch(err => console.error('❌ DISCORD LOGIN FAILED:', err));
}
