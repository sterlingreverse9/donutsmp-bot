const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
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

        // --- BALANCE / PROFILE COMMAND ---
        if (['bal', 'balance', 'profile'].includes(command)) {
            let targetUserId = message.author.id;
            let targetUsername = message.author.username;

            if (message.mentions.users.first()) {
                const targetUser = message.mentions.users.first();
                targetUserId = targetUser.id;
                targetUsername = targetUser.username;
            }

            const user = await getOrCreateUser(targetUserId, targetUsername);

            const embed = new EmbedBuilder()
                .setTitle(`👤 ${targetUsername}'s Profile`)
                .setColor('#3498DB')
                .addFields(
                    { name: 'Balance', value: `$${(user.balance || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Needed', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in general command handler:', err);
        await message.reply('❌ An error occurred processing your request.').catch(() => {});
        return true;
    }
}

module.exports = { handleGeneralCommands };
