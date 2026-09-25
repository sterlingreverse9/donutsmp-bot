const supabase = require('../config/supabase');
const { parseAmount, findTargetUser } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

async function handleAdminCommands(command, args, message, prefix) {
    const isAdmin = message.author.id === process.env.ADMIN_DISCORD_ID;

    if (command === 'add') {
        if (!isAdmin) return message.reply('❌ Admin access required.');
        const targetInput = args[0];
        const amount = parseAmount(args[1]);

        if (!targetInput || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}add <@user/username/userID> <amount>\``);
        }

        const targetUser = await findTargetUser(targetInput, message.mentions.users.first());
        if (!targetUser) return message.reply(`❌ User \`${targetInput}\` not found.`);

        const newBal = (targetUser.balance || 0) + amount;
        await supabase.from('balances').update({ balance: newBal }).eq('user_id', targetUser.user_id);

        return message.reply(`✅ Added **$${amount.toLocaleString()}** to **${targetUser.username || targetUser.user_id}**! New Balance: **$${newBal.toLocaleString()}**`);
    }

    if (['deduct', 'remove', 'sub'].includes(command)) {
        if (!isAdmin) return message.reply('❌ Admin access required.');
        const targetInput = args[0];
        const amount = parseAmount(args[1]);

        if (!targetInput || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}deduct <@user/username/userID> <amount>\``);
        }

        const targetUser = await findTargetUser(targetInput, message.mentions.users.first());
        if (!targetUser) return message.reply(`❌ User \`${targetInput}\` not found.`);

        const newBal = Math.max(0, (targetUser.balance || 0) - amount);
        await supabase.from('balances').update({ balance: newBal }).eq('user_id', targetUser.user_id);

        return message.reply(`💸 Deducted **$${amount.toLocaleString()}** from **${targetUser.username || targetUser.user_id}**! New Balance: **$${newBal.toLocaleString()}**`);
    }

    if (command === 'setwin') {
        if (!isAdmin) return message.reply('❌ Admin access required.');
        const game = args[0] ? args[0].toLowerCase() : null;
        const rate = parseFloat(args[1]);

        if (game !== 'coinflip' || isNaN(rate) || rate < 0 || rate > 100) {
            return message.reply(`❌ **Usage:** \`${prefix}setwin coinflip <0-100>\``);
        }

        await supabase.from('game_settings').upsert({ game_name: 'coinflip', win_rate: rate });
        return message.reply(`✅ Updated **COINFLIP** global win rate to **${rate}%**!`);
    }

    return false; // Command was not handled by admin file
}

module.exports = { handleAdminCommands };
