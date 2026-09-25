const supabase = require('../config/supabase');
const { parseAmount, findTargetUser, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleBankingCommands(command, args, message, prefix) {
    const sender = await getOrCreateUser(message.author.id, message.author.username);

    if (command === 'pay' || command === 'transfer') {
        const targetInput = args[0];
        const amount = parseAmount(args[1]);

        if (!targetInput || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}pay <@user/username/userID> <amount>\``);
        }

        if (sender.balance < amount) {
            return message.reply(`❌ Insufficient balance! Your balance: **$${sender.balance.toLocaleString()}**`);
        }

        const targetUser = await findTargetUser(targetInput, message.mentions.users.first());
        if (!targetUser) return message.reply(`❌ User \`${targetInput}\` not found.`);
        if (targetUser.user_id === sender.user_id) return message.reply("❌ You can't pay yourself!");

        // Deduct from sender, Add to receiver
        await supabase.from('balances').update({ balance: sender.balance - amount }).eq('user_id', sender.user_id);
        await supabase.from('balances').update({ balance: (targetUser.balance || 0) + amount }).eq('user_id', targetUser.user_id);

        return message.reply(`💸 Sent **$${amount.toLocaleString()}** to **${targetUser.username || targetUser.user_id}**!`);
    }

    if (command === 'rakeback') {
        const amount = sender.rakeback || 0;
        if (amount <= 0) return message.reply("❌ You have no rakeback available to claim.");

        const newBal = sender.balance + amount;
        await supabase.from('balances').update({ balance: newBal, rakeback: 0 }).eq('user_id', sender.user_id);

        return message.reply(`🎁 Claimed **$${amount.toLocaleString()}** in rakeback! New Balance: **$${newBal.toLocaleString()}**`);
    }

    if (command === 'wager') {
        const required = sender.wager_required || 0;
        const embed = new EmbedBuilder()
            .setTitle('🎰 Wager Requirement')
            .setColor(0x3498db)
            .setDescription(required > 0 
                ? `You must wager **$${required.toLocaleString()}** more before requesting a withdrawal.`
                : '✅ You have no active wager requirements! You are eligible for withdrawal.')
            .setFooter({ text: 'Donut SMP Bot' });

        return message.reply({ embeds: [embed] });
    }

    return false; // Command not handled in this file
}

module.exports = { handleBankingCommands };
