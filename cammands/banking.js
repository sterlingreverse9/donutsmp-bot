const supabase = require('../config/supabase');
const { parseAmount, findTargetUser, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleBankingCommands(command, args, message, prefix) {
    const sender = await getOrCreateUser(message.author.id, message.author.username);

    if (['pay', 'transfer', 'tip'].includes(command)) {
        const targetInput = args[0];
        const amount = parseAmount(args[1]);

        if (!targetInput || !amount || amount <= 0) {
            await message.reply(`❌ **Usage:** \`${prefix}pay <@user/username/userID> <amount>\``);
            return true;
        }

        if (sender.balance < amount) {
            await message.reply(`❌ Insufficient balance! Balance: **$${sender.balance.toLocaleString()}**`);
            return true;
        }

        const targetUser = await findTargetUser(targetInput, message.mentions.users.first());
        if (!targetUser) {
            await message.reply(`❌ User \`${targetInput}\` not found.`);
            return true;
        }
        if (targetUser.user_id === sender.user_id) {
            await message.reply("❌ You can't pay yourself!");
            return true;
        }

        await supabase.from('balances').update({ balance: sender.balance - amount }).eq('user_id', sender.user_id);
        await supabase.from('balances').update({ balance: (targetUser.balance || 0) + amount }).eq('user_id', targetUser.user_id);

        await message.reply(`💸 Sent **$${amount.toLocaleString()}** to **${targetUser.username || targetUser.user_id}**!`);
        return true;
    }

    return false;
}

module.exports = { handleBankingCommands };
