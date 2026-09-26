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

client.once('ready', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}!`);

    const { data } = await supabase.from('game_settings').select('is_active').eq('game_name', 'bot_status').single();
    if (data !== null && data !== undefined) {
        botState.setBotStatus(data.is_active);
    }
});

// Acknowledge Discord UI Buttons instantly to prevent timeout errors
client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
        await interaction.reply({ content: 'Please use text commands like `!paid` or `!cancel` to proceed.', ephemeral: true }).catch(() => {});
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let content = message.content.trim();
    if (!content.startsWith(PREFIX) && !content.startsWith('/')) return;

    const args = content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // 1. Check Admin commands first
    const isAdminCmd = await handleAdminCommands(command, args, message, PREFIX);
    if (isAdminCmd) return;

    // 2. Enforce Bot OFF status strictly for normal users
    if (!botState.getBotStatus()) {
        await message.reply('🔴 **The bot is currently OFF.** Please contact the administrator to turn it on.');
        return;
    }

    // 3. Process Game and User commands
    const isGameCmd = await handleGameCommands(command, args, message, PREFIX);
    if (isGameCmd) return;

    await handleUserCommands(command, args, message, PREFIX);
});

client.login(process.env.DISCORD_TOKEN);
