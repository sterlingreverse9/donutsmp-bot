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
app.listen(PORT, () => console.log(`HTTP server running on port ${PORT}`));

// Keep alive ping
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

        if (typeof handleGeneralCommands === 'function' && !handled) {
            handled = await handleGeneralCommands(command, args, message, prefix);
        }
        if (typeof handleGameCommands === 'function' && !handled) {
            handled = await handleGameCommands(command, args, message, prefix);
        }
        if (typeof handleBankingCommands === 'function' && !handled) {
            handled = await handleBankingCommands(command, args, message, prefix);
        }
        if (typeof handleAdminCommands === 'function' && !handled) {
            handled = await handleAdminCommands(command, args, message, prefix);
        }

        if (!handled) {
            console.log(`⚠️ Unrecognized command: "${command}"`);
        }
    } catch (err) {
        console.error(`❌ Global error processing command '${command}':`, err);
        message.reply('❌ An internal error occurred while executing that command.').catch(() => {});
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
