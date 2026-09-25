const express = require('express');
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

const { handleAdminCommands } = require('./commands/admin');
const { handleInteractions } = require('./handlers/interactions');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

// Keep-Alive
setInterval(() => {
    http.get(`http://localhost:${PORT}`).on('error', (err) => console.error(err.message));
}, 5 * 60 * 1000);

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

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Delegate execution to specialized modules
    const handledByAdmin = await handleAdminCommands(command, args, message, prefix);
    if (handledByAdmin) return;
});

client.on('interactionCreate', async (interaction) => {
    await handleInteractions(interaction, client);
});

// Explicit Login
if (!process.env.DISCORD_TOKEN) {
    console.error('❌ DISCORD_TOKEN is missing!');
} else {
    console.log('Initiating connection to Discord...');
    client.login(process.env.DISCORD_TOKEN)
        .then(() => console.log('✅ Connected to Discord Gateway!'))
        .catch(err => console.error('❌ DISCORD LOGIN FAILED:', err));
}
