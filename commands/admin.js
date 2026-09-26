const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

// Add your Discord User ID(s) here. Leave array empty [] if you want to allow all users during testing.
const ADMIN_IDS = [];

async function handleAdminCommands(command, args, message, prefix) {
    try {
        // --- ADD BALANCE & DEDUCT BALANCE COMMANDS ---
        if (['addbalance', 'addbal', 'deductbalance', 'deductbal'].includes(command)) {
            // Admin permission check
            if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(message.author.id)) {
                await message.reply('❌ You do not have permission to use admin balance commands.');
                return true;
            }

            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}${command} <@user|userID> <amount>\`\n*Example:* \`${prefix}${command} @foggy 1m\``);
                return true;
            }

            // Parse target user from Discord mention or raw user ID string
            const targetUserObj = message.mentions.users.first();
            const targetUserId = targetUserObj ? targetUserObj.id : args[0].replace(/[<@!>]/g, '');
            const targetUsername = targetUserObj ? targetUserObj.username : `User_${targetUserId}`;

            if (!targetUserId || targetUserId.length < 5) {
                await message.reply('❌ Invalid user specified. Mention a user or provide a valid user ID.');
                return true;
            }

            // Parse currency amount (e.g., 100, 500k, 1m, 2b)
            const amount = parseAmount(args[1]);
            if (!amount || amount <= 0) {
                await message.reply('❌ Invalid amount specified. Use numbers or formats like `500k`, `1m`.');
                return true;
            }

            // Get existing user or initialize record
            const user = await getOrCreateUser(targetUserId, targetUsername);
            const currentBalance = user.balance || 0;
            const isAdd = ['addbalance', 'addbal'].includes(command);

            const newBalance = isAdd 
                ? currentBalance + amount 
                : Math.max(0, currentBalance - amount);

            // Update database record in Supabase
            const { error } = await supabase.from('balances').upsert({
                user_id: targetUserId,
                username: targetUsername,
                balance: newBalance
            }, { onConflict: 'user_id' });

            if (error) {
                console.error('❌ Supabase database error:', error);
                await message.reply('❌ Failed to update balance in database.');
                return true;
            }

            const embed = new EmbedBuilder()
                .setTitle(isAdd ? '💳 Balance Added' : '📉 Balance Deducted')
                .setColor(isAdd ? '#2ECC71' : '#E74C3C')
                .addFields(
                    { name: 'Target User', value: `<@${targetUserId}>`, inline: true },
                    { name: 'Amount', value: `$${amount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Admin Management' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in admin command handler:', err);
        await message.reply('❌ An error occurred processing the admin command.').catch(() => {});
        return true;
    }
}

module.exports = { handleAdminCommands };
