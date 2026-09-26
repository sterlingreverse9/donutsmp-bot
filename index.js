const express = require('express');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Load Command Handlers safely into module scope
let handleGeneralCommands, handleGameCommands, handleBankingCommands, handleAdminCommands, handleInteractions;

try {
    handleGeneralCommands = require('./commands/general').handleGeneralCommands;
    handleGameCommands = require('./commands/games').handleGameCommands;
    handleBankingCommands = require('./commands/banking').handleBankingCommands;
    handleAdminCommands = require('./commands/admin').handleAdminCommands;
    handleInteractions = require('./handlers/interactions').handleInteractions;
    console.log('✅ Handlers Loaded:', {
        general: typeof handleGeneralCommands === 'function',
        games: typeof handleGameCommands === 'function',
        banking: typeof handleBankingCommands === 'function',
        admin: typeof handleAdminCommands === 'function'
    });
} catch (err) {
    console.error('❌ CRITICAL: Failed to load command handlers:', err);
}

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server running on port ${PORT}`));

// Keep-alive server ping
setInterval(() => {
    http.get(`http://localhost:${PORT}`).on('error', () => {});
}, 5 * 60 * 1000);

process.on('unhandledRejection', (reason) => console.error('❌ Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('❌ Uncaught Exception:', err));

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

client.once('clientReady', () => {
    console.log(`🤖 SUCCESS: Bot connected as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    console.log(`[EXECUTING COMMAND] Name: "${command}" | Args:`, args);

    try {
        let handled = false;

        // Execute handlers in priority order
        if (!handled && typeof handleGeneralCommands === 'function') {
            handled = await handleGeneralCommands(command, args, message, prefix);
        }
        if (!handled && typeof handleGameCommands === 'function') {
            handled = await handleGameCommands(command, args, message, prefix);
        }
        if (!handled && typeof handleBankingCommands === 'function') {
            handled = await handleBankingCommands(command, args, message, prefix);
        }
        if (!handled && typeof handleAdminCommands === 'function') {
            handled = await handleAdminCommands(command, args, message, prefix);
        }

        if (!handled) {
            console.log(`⚠️ Unrecognized command: "${command}"`);
        } else {
            console.log(`✅ Successfully executed command: "${command}"`);
        }
    } catch (err) {
        console.error(`❌ Global Command Execution Error ['${command}']:`, err);
        message.reply('❌ An error occurred while executing that command. Check Render logs.').catch(() => {});
    }
});

client.on('interactionCreate', async (interaction) => {
    if (typeof handleInteractions === 'function') {
        try {
            await handleInteractions(interaction, client);
        } catch (err) {
            console.error('❌ Interaction Error:', err);
        }
    }
});

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.error('❌ DISCORD_TOKEN missing in environment variables.');
}
