const { StringSelectMenuBuilder, ActionRowBuilder, EmbedBuilder } = require('discord.js');

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
                    { label: 'Coinflip', value: 'cf', description: 'Configure Coinflip win odds' },
                    { label: 'Dice', value: 'dice', description: 'Configure Dice win odds' },
                    { label: 'Mines', value: 'mines', description: 'Configure Mines win odds' },
                    { label: 'Slots', value: 'slots', description: 'Configure Slots win odds' }
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
