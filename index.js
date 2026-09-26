const { Client, GatewayIntentBits } = require('discord.js');
const supabase = require('./config/supabase');
const botState = require('./config/botState');
const { handleAdminCommands } = require('./commands/admin');
const { handleGameCommands } = require('./commands/games');
const { handleUserCommands } = require('./commands/user');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const PREFIX = '!';
const ADMIN_ID = '1453068990187438086';

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);

    // Sync bot state from database
    const { data } = await supabase.from('game_settings').select('is_active').eq('game_name', 'bot_status').single();
    if (data !== null && data !== undefined) {
        botState.setBotStatus(data.is_active);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Detect command prefix or slash triggers
    let content = message.content.trim();
    if (!content.startsWith(PREFIX) && !content.startsWith('/')) return;

    const args = content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // 1. Owner & Admin Commands execution check (always allowed regardless of bot status)
    const isAdminCmd = await handleAdminCommands(command, args, message, PREFIX);
    if (isAdminCmd) return;

    // 2. Check if bot is turned OFF
    if (!botState.getBotStatus()) {
        await message.reply('🔴 **The bot is currently OFF.** Please contact the administrator to turn it on.');
        return;
    }

    // 3. Game & User Commands execution
    const isGameCmd = await handleGameCommands(command, args, message, PREFIX);
    if (isGameCmd) return;

    const isUserCmd = await handleUserCommands(command, args, message, PREFIX);
    if (isUserCmd) return;
});

client.login(process.env.DISCORD_TOKEN);
