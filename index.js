const express = require('express');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Import Command Handlers
let handleAdminCommands, handleBankingCommands, handleGameCommands, handleGeneralCommands, handleInteractions;

try {
    handleAdminCommands = require('./commands/admin').handleAdminCommands;
    handleBankingCommands = require('./commands/banking').handleBankingCommands;
    handleGameCommands = require('./commands/games').handleGameCommands;
    handleGeneralCommands = require('./commands/general').handleGeneralCommands;
    handleInteractions = require('./handlers/interactions').handleInteractions;
    console.log('✅ ALL COMMAND MODULES LOADED SUCCESSFULLY!');
} catch (err) {
    console.error('❌ CRITICAL ERROR LOADING MODULES:', err);
}

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server running on port ${PORT}`));

// Keep alive self-ping
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
    // 1. Raw Event Diagnostic Logging
    console.log(`[RAW MESSAGE] Author: ${message.author.tag} | Bot: ${message.author.bot} | Content: "${message.content}"`);

    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) {
        console.log(`[PREFIX CHECK FAILED] Message does not start with valid prefix: "${message.content}"`);
        return;
    }

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    console.log(`[EXECUTING COMMAND] Name: "${command}" | Args:`, args);

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

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.error('❌ DISCORD_TOKEN missing in environment variables.');
}
