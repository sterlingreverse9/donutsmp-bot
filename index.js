const { Client, GatewayIntentBits, Partials } = require('discord.js');
const http = require('http');
const supabase = require('./config/supabase');
const botState = require('./config/botState');
const { handleAdminCommands } = require('./commands/admin');
const { handleGameCommands } = require('./commands/games');
const { handleUserCommands } = require('./commands/user');

// --- HEALTH CHECK SERVER FOR RENDER ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Donut Bet Bot is alive!');
}).listen(PORT, () => {
    console.log(`🌐 Health check server active on port ${PORT}`);
});

// --- DISCORD CLIENT SETUP WITH PARTIALS ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

const PREFIX = '!';

client.once('clientReady', async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);

    try {
        const { data } = await supabase.from('game_settings').select('is_active').eq('game_name', 'bot_status').single();
        if (data !== null && data !== undefined) {
            botState.setBotStatus(data.is_active);
            console.log(`📊 Bot active state loaded from database: ${data.is_active}`);
        } else {
            botState.setBotStatus(true); // Default to ON if setting doesn't exist
        }
    } catch (err) {
        console.error('⚠️ Supabase sync error, defaulting bot state to ON:', err.message);
        botState.setBotStatus(true);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        await interaction.reply({ content: 'Please use text commands like `!paid` or `!cancel`.', ephemeral: true }).catch(() => {});
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let content = message.content.trim();
    if (!content.startsWith(PREFIX) && !content.startsWith('/')) return;

    console.log(`📩 Received command from ${message.author.username}: "${content}"`);

    const args = content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        // 1. Check Admin commands first (works even if bot is marked OFF)
        const isAdminCmd = await handleAdminCommands(command, args, message, PREFIX);
        if (isAdminCmd) {
            console.log(`✅ Handled as Admin Command: ${command}`);
            return;
        }

        // 2. Enforce Bot Status
        if (!botState.getBotStatus()) {
            console.log(`🔴 Command rejected: Bot is set to OFF.`);
            await message.reply('🔴 **The bot is currently OFF.** Contact admin or run `!startbot`.');
            return;
        }

        // 3. Process Game Commands
        const isGameCmd = await handleGameCommands(command, args, message, PREFIX);
        if (isGameCmd) {
            console.log(`✅ Handled as Game Command: ${command}`);
            return;
        }

        // 4. Process User Commands
        const isUserCmd = await handleUserCommands(command, args, message, PREFIX);
        if (isUserCmd) {
            console.log(`✅ Handled as User Command: ${command}`);
            return;
        }

        console.log(`❓ Unknown command: ${command}`);
    } catch (err) {
        console.error(`❌ Error handling command "${command}":`, err);
        await message.reply('❌ An internal error occurred while processing this command. Check bot server logs.').catch(() => {});
    }
});

client.login(process.env.DISCORD_TOKEN);
