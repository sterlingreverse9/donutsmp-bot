const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    try {
        // --- START / REGISTER COMMAND ---
        if (['start', 'register'].includes(command)) {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            
            const embed = new EmbedBuilder()
                .setTitle('🎉 Welcome to Donut Bet!')
                .setColor('#F1C40F')
                .setDescription(`Hello **${message.author.username}**! Your account is active.`)
                .addFields(
                    { name: 'Balance', value: `$${(user.balance || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Required', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in general command:', err);
        return false;
    }
}

module.exports = { handleGeneralCommands };
