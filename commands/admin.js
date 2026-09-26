const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleAdminCommands(command, args, message, prefix) {
    try {
        const isAdmin = message.member?.permissions.has('Administrator');
        if (!isAdmin) return false;

        // --- ADDBAL COMMAND ---
        if (['addbal', 'addbalance'].includes(command)) {
            const targetUser = message.mentions.users.first();
            const rawAmount = args[1];

            if (!targetUser || !rawAmount) {
                await message.reply(`❌ **Usage:** \`${prefix}addbal @user <amount>\``);
                return true;
            }

            const amount = parseAmount(rawAmount);
            if (!amount || amount <= 0) {
                await message.reply('❌ **Invalid amount.**');
                return true;
            }

            const userData = await getOrCreateUser(targetUser.id, targetUser.username);
            const newBalance = (userData.balance || 0) + amount;
            const newWager = (userData.wager_required || 0) + amount;

            const { error } = await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                balance: newBalance,
                wager_required: newWager
            }, { onConflict: 'user_id' });

            if (error) throw error;

            await message.reply(`✅ Added **$${amount.toLocaleString()}** to ${targetUser.username}'s balance! (Wager Req: +$${amount.toLocaleString()})`);
            return true;
        }

        // --- DEDUCTBAL COMMAND ---
        if (['deductbal', 'removebal'].includes(command)) {
            const targetUser = message.mentions.users.first();
            const rawAmount = args[1];

            if (!targetUser || !rawAmount) {
                await message.reply(`❌ **Usage:** \`${prefix}deductbal @user <amount>\``);
                return true;
            }

            const amount = parseAmount(rawAmount);
            if (!amount || amount <= 0) {
                await message.reply('❌ **Invalid amount.**');
                return true;
            }

            const userData = await getOrCreateUser(targetUser.id, targetUser.username);
            const newBalance = Math.max(0, (userData.balance || 0) - amount);

            const { error } = await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                balance: newBalance
            }, { onConflict: 'user_id' });

            if (error) throw error;

            await message.reply(`✅ Deducted **$${amount.toLocaleString()}** from ${targetUser.username}'s balance! New Balance: **$${newBalance.toLocaleString()}**`);
            return true;
        }

        // --- SET WAGER COMMAND ---
        if (['setwager', 'sw'].includes(command)) {
            const targetUser = message.mentions.users.first();
            const rawAmount = args[1];

            if (!targetUser || !rawAmount) {
                await message.reply(`❌ **Usage:** \`${prefix}setwager @user <amount>\``);
                return true;
            }

            const wagerAmount = parseAmount(rawAmount);
            if (isNaN(wagerAmount) || wagerAmount < 0) {
                await message.reply('❌ **Invalid wager amount.**');
                return true;
            }

            await getOrCreateUser(targetUser.id, targetUser.username);

            const { error } = await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                wager_required: wagerAmount
            }, { onConflict: 'user_id' });

            if (error) throw error;

            await message.reply(`✅ Updated ${targetUser.username}'s wager requirement to **$${wagerAmount.toLocaleString()}**.`);
            return true;
        }

        // --- WIN COINFLIP CHANCE COMMAND ---
        if (['wincoin', 'wincf'].includes(command)) {
            const chance = parseFloat(args[0]);

            if (isNaN(chance) || chance < 0 || chance > 100) {
                await message.reply(`❌ **Usage:** \`${prefix}wincoin <0-100>\`\n*Example:* \`${prefix}wincoin 60\``);
                return true;
            }

            const { error } = await supabase.from('game_settings').upsert({
                game_name: 'cf',
                win_chance: chance
            }, { onConflict: 'game_name' });

            if (error) throw error;

            await message.reply(`🎰 **Coinflip win rate updated to ${chance}%!**`);
            return true;
        }

        // --- TIP / PAY COMMAND ---
        if (['pay', 'tip'].includes(command)) {
            const targetUser = message.mentions.users.first();
            const rawAmount = args[1];

            if (!targetUser || targetUser.id === message.author.id) {
                await message.reply(`❌ **Usage:** \`${prefix}tip @user <amount>\``);
                return true;
            }

            const amount = parseAmount(rawAmount);
            if (!amount || amount <= 0) {
                await message.reply('❌ **Invalid amount.**');
                return true;
            }

            const sender = await getOrCreateUser(message.author.id, message.author.username);
            if ((sender.balance || 0) < amount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${(sender.balance || 0).toLocaleString()}**`);
                return true;
            }

            const receiver = await getOrCreateUser(targetUser.id, targetUser.username);

            // Deduct balance from sender
            await supabase.from('balances').upsert({
                user_id: message.author.id,
                username: message.author.username,
                balance: sender.balance - amount
            }, { onConflict: 'user_id' });

            // Add balance & wager requirement to recipient
            await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                balance: (receiver.balance || 0) + amount,
                wager_required: (receiver.wager_required || 0) + amount
            }, { onConflict: 'user_id' });

            await message.reply(`💸 You tipped **$${amount.toLocaleString()}** to ${targetUser.username}!`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in admin command:', err);
        await message.reply('❌ An error occurred executing that command.');
        return true;
    }
}

module.exports = { handleAdminCommands };
