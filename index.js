const express = require('express');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Import Command Handlers
const { handleAdminCommands } = require('./commands/admin');
const { handleBankingCommands } = require('./commands/banking');
const { handleGameCommands } = require('./commands/games');
const { handleGeneralCommands } = require('./commands/general');
const { handleInteractions } = require('./handlers/interactions');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

// Keep-Alive Ping
setInterval(() => {
    http.get(`http://localhost:${PORT}`).on('error', (err) => console.error(err.message));
}, 5 * 60 * 1000);

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

// Environment Variable Check
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

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Cascading execution across modules
    const handled = 
        await handleAdminCommands(command, args, message, prefix) ||
        await handleBankingCommands(command, args, message, prefix) ||
        await handleGameCommands(command, args, message, prefix) ||
        await handleGeneralCommands(command, args, message, prefix);
});

client.on('interactionCreate', async (interaction) => {
    await handleInteractions(interaction, client);
});

// Discord Authentication Call
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD LOGIN SKIPPED: Missing DISCORD_TOKEN environment variable.');
} else {
    console.log('Initiating connection to Discord...');
    client.login(process.env.DISCORD_TOKEN)
        .then(() => console.log('✅ Connected to Discord Gateway successfully!'))
        .catch(err => console.error('❌ DISCORD LOGIN FAILED:', err));
}
