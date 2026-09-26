const express = require('express');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

// Direct imports without try-catch hiding load errors
const { handleGeneralCommands } = require('./commands/general');
const { handleGameCommands } = require('./commands/games');
const { handleBankingCommands } = require('./commands/banking');
const { handleAdminCommands } = require('./commands/admin');
const { handleInteractions } = require('./handlers/interactions');

console.log('--- MODULE CHECK AT STARTUP ---');
console.log('handleGeneralCommands:', typeof handleGeneralCommands);
console.log('handleGameCommands:', typeof handleGameCommands);
console.log('handleBankingCommands:', typeof handleBankingCommands);
console.log('handleAdminCommands:', typeof handleAdminCommands);
console.log('--------------------------------');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot active'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

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
    console.log(`🤖 Bot online: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    console.log(`[COMMAND LOG] Name: "${command}" | Sender: ${message.author.tag}`);

    try {
        let handled = false;

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
            console.log(`⚠️ Unhandled command: "${command}"`);
        }
    } catch (err) {
        console.error(`❌ Dispatcher Exception ['${command}']:`, err);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (typeof handleInteractions === 'function') {
        try {
            await handleInteractions(interaction, client);
        } catch (err) {
            console.error('❌ Interaction exception:', err);
        }
    }
});

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN);
} else {
    console.error('❌ DISCORD_TOKEN is missing.');
}
