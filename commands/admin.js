const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');
const botState = require('../config/botState');

// Primary Admin Discord IDs allowed to run admin commands anywhere (including DMs)
const ADMIN_IDS = ['1453068990187438086']; 

async function handleAdminCommands(command, args, message, prefix) {
    try {
        const isOwner = ADMIN_IDS.includes(message.author.id);
        const isAdmin = isOwner || (message.member && message.member.permissions.has('Administrator'));

        // --- STARTBOT COMMAND ---
        if (['startbot'].includes(command)) {
            if (!isAdmin) {
                await message.reply('❌ You do not have permission to use this command.');
                return true;
            }
            botState.setBotStatus(true);
            await supabase.from('game_settings').upsert({ game_name: 'bot_status', is_active: true }, { onConflict: 'game_name' });
            await message.reply('🟢 **Bot has been turned ON.** All commands are now accessible.');
            return true;
        }

        // --- STOPBOT COMMAND ---
        if (['stopbot'].includes(command)) {
            if (!isAdmin) {
                await message.reply('❌ You do not have permission to use this command.');
                return true;
            }
            botState.setBotStatus(false);
            await supabase.from('game_settings').upsert({ game_name: 'bot_status', is_active: false }, { onConflict: 'game_name' });
            await message.reply('🔴 **Bot has been turned OFF.** Commands are disabled for regular users.');
            return true;
        }

        // --- WIN COINFLIP CHANCE COMMAND ---
        if (['wincf', 'wincoin'].includes(command)) {
            if (!isAdmin) {
                await message.reply('❌ You do not have permission to use this command.');
                return true;
            }

            const chance = parseFloat(args[0]);
            if (isNaN(chance) || chance < 0 || chance > 100) {
                await message.reply(`❌ **Usage:** \`${prefix}wincf <0-100>\`\n*Example:* \`${prefix}wincf 20\``);
                return true;
            }

            const { error } = await supabase.from('game_settings').upsert({
                game_name: 'cf',
                win_chance: chance
            }, { onConflict: 'game_name' });

            if (error) throw error;

            await message.reply(`🎰 **Coinflip win rate set to ${chance}%!**`);
            return true;
        }

        // --- APPROVE DEPOSIT ---
        if (['approvedepo', 'approvedeposit', 'appdepo'].includes(command)) {
            if (!isAdmin) return true;
            const depoId = args[0];
            if (!depoId) {
                await message.reply(`❌ **Usage:** \`${prefix}approvedepo <depo_id>\``);
                return true;
            }

            const { data: depo } = await supabase.from('pending_deposits').select('*').eq('id', depoId).single();
            if (!depo || depo.status !== 'pending_approval') {
                await message.reply('❌ Invalid or non-pending deposit ID.');
                return true;
            }

            const userData = await getOrCreateUser(depo.user_id, depo.username);
            const newBal = (userData.balance || 0) + depo.amount;
            const newWager = (userData.wager_required || 0) + depo.amount; // 1x wager condition

            await supabase.from('balances').upsert({
                user_id: depo.user_id,
                username: depo.username,
                balance: newBal,
                wager_required: newWager
            }, { onConflict: 'user_id' });

            await supabase.from('pending_deposits').update({ status: 'approved' }).eq('id', depoId);
            await message.reply(`✅ Approved Deposit \`${depoId}\` for $${depo.amount.toLocaleString()}!`);

            try {
                const userObj = await message.client.users.fetch(depo.user_id);
                await userObj.send(`✅ **Your deposit of $${depo.amount.toLocaleString()} (ID:${depoId}) has been approved!** You can now play.`);
            } catch (err) {}
            return true;
        }

        // --- DENY DEPOSIT ---
        if (['denydepo', 'denydeposit'].includes(command)) {
            if (!isAdmin) return true;
            const depoId = args[0];
            if (!depoId) {
                await message.reply(`❌ **Usage:** \`${prefix}denydepo <depo_id>\``);
                return true;
            }

            const { data: depo } = await supabase.from('pending_deposits').select('*').eq('id', depoId).single();
            if (!depo || depo.status !== 'pending_approval') {
                await message.reply('❌ Invalid or non-pending deposit ID.');
                return true;
            }

            await supabase.from('pending_deposits').update({ status: 'denied' }).eq('id', depoId);
            await message.reply(`🚫 Denied Deposit \`${depoId}\`.`);

            try {
                const userObj = await message.client.users.fetch(depo.user_id);
                await userObj.send(`❌ **Your deposit (ID: ${depoId}) was declined.** Please contact admin @piyushyadav83 for assistance.`);
            } catch (err) {}
            return true;
        }

        // --- APPROVE WITHDRAWAL ---
        if (['approvewd', 'appwd'].includes(command)) {
            if (!isAdmin) return true;
            const wdId = args[0];
            if (!wdId) {
                await message.reply(`❌ **Usage:** \`${prefix}approvewd <wd_id>\``);
                return true;
            }

            const { data: wd } = await supabase.from('pending_withdrawals').select('*').eq('id', wdId).single();
            if (!wd || wd.status !== 'pending_approval') {
                await message.reply('❌ Invalid or non-pending withdrawal ID.');
                return true;
            }

            await supabase.from('pending_withdrawals').update({ status: 'approved' }).eq('id', wdId);
            await message.reply(`✅ Approved Withdrawal \`${wdId}\`.`);

            try {
                const userObj = await message.client.users.fetch(wd.user_id);
                await userObj.send(`✅ **Your withdrawal of $${wd.amount.toLocaleString()} has been approved!** You received your money in-game. Please drop a vouch!`);
            } catch (err) {}

            if (message.channel) {
                await message.channel.send(`🎉 **Withdrawal Approved!** <@${wd.user_id}> successfully withdrew **$${wd.amount.toLocaleString()}**!`);
            }
            return true;
        }

        // --- DENY WITHDRAWAL ---
        if (['declinewd', 'denywd'].includes(command)) {
            if (!isAdmin) return true;
            const wdId = args[0];
            if (!wdId) {
                await message.reply(`❌ **Usage:** \`${prefix}declinewd <wd_id>\``);
                return true;
            }

            const { data: wd } = await supabase.from('pending_withdrawals').select('*').eq('id', wdId).single();
            if (!wd || wd.status !== 'pending_approval') {
                await message.reply('❌ Invalid or non-pending withdrawal ID.');
                return true;
            }

            const userData = await getOrCreateUser(wd.user_id, wd.username);
            await supabase.from('balances').upsert({
                user_id: wd.user_id,
                username: wd.username,
                balance: (userData.balance || 0) + wd.amount
            }, { onConflict: 'user_id' });

            await supabase.from('pending_withdrawals').update({ status: 'denied' }).eq('id', wdId);
            await message.reply(`🚫 Declined Withdrawal \`${wdId}\`. Funds refunded to user balance.`);

            try {
                const userObj = await message.client.users.fetch(wd.user_id);
                await userObj.send(`❌ **Your withdrawal of $${wd.amount.toLocaleString()} (ID:${wdId}) was declined.** Funds have been restored to your bot balance. Contact @piyushyadav83 for help.`);
            } catch (err) {}
            return true;
        }

        // --- ADDBAL COMMAND ---
        if (['addbal', 'addbalance'].includes(command)) {
            if (!isAdmin) return true;
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

            await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                balance: newBalance,
                wager_required: newWager
            }, { onConflict: 'user_id' });

            await message.reply(`✅ Added **$${amount.toLocaleString()}** to ${targetUser.username}'s balance!`);
            return true;
        }

        // --- DEDUCTBAL COMMAND ---
        if (['deductbal', 'removebal'].includes(command)) {
            if (!isAdmin) return true;
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

            await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                balance: newBalance
            }, { onConflict: 'user_id' });

            await message.reply(`✅ Deducted **$${amount.toLocaleString()}** from ${targetUser.username}'s balance!`);
            return true;
        }

        // --- SET WAGER COMMAND ---
        if (['setwager', 'sw'].includes(command)) {
            if (!isAdmin) return true;
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

            await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                wager_required: wagerAmount
            }, { onConflict: 'user_id' });

            await message.reply(`✅ Updated ${targetUser.username}'s wager requirement to **$${wagerAmount.toLocaleString()}**.`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in admin command:', err);
        return false;
    }
}

module.exports = { handleAdminCommands };
