const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

async function handleAdminCommands(command, args, message, prefix) {
    try {
        const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;

        if (message.author.id !== ADMIN_ID) {
            return false;
        }

        // --- /win COMMAND ---
        if (['win', 'rig', 'riggame'].includes(command)) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_win_game')
                .setPlaceholder('Select a game to set win chances')
                .addOptions([
                    { label: 'Coinflip (cf)', value: 'cf', description: 'Configure Coinflip win odds' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await message.reply({
                content: '⚙️ **Admin Game Odds Configurator:** Select a game below:',
                components: [row]
            });

            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in handleAdminCommands:', err);
        await message.reply('❌ Error executing admin command.');
        return true;
    }
}

module.exports = { handleAdminCommands };
