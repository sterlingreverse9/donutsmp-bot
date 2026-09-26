const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

// Add Admin User IDs here (leave empty [] to allow all during testing)
const ADMIN_IDS = [];

async function handleAdminCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(userId)) {
            await message.reply('❌ You do not have permission to run admin commands.');
            return true;
        }

        // ==========================================
        // 1. APPROVE & DENY DEPOSITS
        // ==========================================
        if (['approvedepo', 'approvedeposit', 'denydepo', 'denydeposit'].includes(command)) {
            if (args.length < 1) {
                await message.reply(`❌ **Usage:** \`${prefix}${command} <Deposit_ID>\`\n*Example:* \`${prefix}approvedepo DEP-481272\``);
                return true;
            }

            const depId = args[0].toUpperCase().trim();
            const isApprove = ['approvedepo', 'approvedeposit'].includes(command);

            // Fetch deposit record from Supabase
            const { data: depRecord, error: fetchErr } = await supabase
                .from('deposits')
                .select('*')
                .eq('deposit_id', depId)
                .single();

            if (fetchErr || !depRecord) {
                await message.reply(`❌ Deposit request **${depId}** not found.`);
                return true;
            }

            if (depRecord.status !== 'pending') {
                await message.reply(`⚠️ Deposit **${depId}** has already been processed (${depRecord.status}).`);
                return true;
            }

            if (isApprove) {
                // Fetch target user and add deposit amount to balance
                const user = await getOrCreateUser(depRecord.user_id, depRecord.username);
                const newBalance = (user.balance || 0) + depRecord.amount;

                // Update balance & mark deposit as approved
                await supabase.from('balances').upsert({
                    user_id: depRecord.user_id,
                    username: depRecord.username,
                    balance: newBalance
                }, { onConflict: 'user_id' });

                await supabase.from('deposits').update({ status: 'approved' }).eq('deposit_id', depId);

                const embed = new EmbedBuilder()
                    .setTitle('✅ Deposit Approved')
                    .setColor('#2ECC71')
                    .addFields(
                        { name: 'Deposit ID', value: `\`${depId}\``, inline: true },
                        { name: 'User', value: `<@${depRecord.user_id}>`, inline: true },
                        { name: 'Amount Added', value: `$${depRecord.amount.toLocaleString()}`, inline: true },
                        { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Management' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                // Mark deposit as denied
                await supabase.from('deposits').update({ status: 'denied' }).eq('deposit_id', depId);

                const embed = new EmbedBuilder()
                    .setTitle('❌ Deposit Denied')
                    .setColor('#E74C3C')
                    .addFields(
                        { name: 'Deposit ID', value: `\`${depId}\``, inline: true },
                        { name: 'User', value: `<@${depRecord.user_id}>`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Management' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

            return true;
        }

        // ==========================================
        // 2. APPROVE & DENY WITHDRAWALS
        // ==========================================
        if (['approvewd', 'declinewd', 'denywd'].includes(command)) {
            if (args.length < 1) {
                await message.reply(`❌ **Usage:** \`${prefix}${command} <Withdrawal_ID>\`\n*Example:* \`${prefix}approvewd WD-802795\``);
                return true;
            }

            const wdId = args[0].toUpperCase().trim();
            const isApprove = command === 'approvewd';

            const { data: wdRecord, error: fetchErr } = await supabase
                .from('withdrawals')
                .select('*')
                .eq('request_id', wdId)
                .single();

            if (fetchErr || !wdRecord) {
                await message.reply(`❌ Withdrawal request **${wdId}** not found.`);
                return true;
            }

            if (wdRecord.status !== 'pending') {
                await message.reply(`⚠️ Request **${wdId}** has already been processed (${wdRecord.status}).`);
                return true;
            }

            if (isApprove) {
                await supabase.from('withdrawals').update({ status: 'approved' }).eq('request_id', wdId);

                const embed = new EmbedBuilder()
                    .setTitle('✅ Withdrawal Approved')
                    .setColor('#2ECC71')
                    .addFields(
                        { name: 'Request ID', value: `\`${wdId}\``, inline: true },
                        { name: 'User', value: `<@${wdRecord.user_id}>`, inline: true },
                        { name: 'Amount Approved', value: `$${wdRecord.amount.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Management' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                // Refund balance back to user if declined
                const user = await getOrCreateUser(wdRecord.user_id, wdRecord.username);
                const restoredBalance = (user.balance || 0) + wdRecord.amount;

                await supabase.from('balances').update({ balance: restoredBalance }).eq('user_id', wdRecord.user_id);
                await supabase.from('withdrawals').update({ status: 'declined' }).eq('request_id', wdId);

                const embed = new EmbedBuilder()
                    .setTitle('❌ Withdrawal Declined')
                    .setColor('#E74C3C')
                    .addFields(
                        { name: 'Request ID', value: `\`${wdId}\``, inline: true },
                        { name: 'User', value: `<@${wdRecord.user_id}>`, inline: true },
                        { name: 'Refunded Amount', value: `$${wdRecord.amount.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Management' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

            return true;
        }

        // ==========================================
        // 3. MANUAL BALANCE ADD / DEDUCT
        // ==========================================
        if (['addbalance', 'addbal', 'deductbalance', 'deductbal'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}${command} <@user|userID> <amount>\``);
                return true;
            }

            const targetUserObj = message.mentions.users.first();
            const targetUserId = targetUserObj ? targetUserObj.id : args[0].replace(/[<@!>]/g, '');
            const targetUsername = targetUserObj ? targetUserObj.username : `User_${targetUserId}`;

            const amount = parseAmount(args[1]);
            if (!amount || amount <= 0) {
                await message.reply('❌ Invalid amount specified.');
                return true;
            }

            const user = await getOrCreateUser(targetUserId, targetUsername);
            const currentBalance = user.balance || 0;
            const isAdd = ['addbalance', 'addbal'].includes(command);
            const newBalance = isAdd ? currentBalance + amount : Math.max(0, currentBalance - amount);

            const { error } = await supabase.from('balances').upsert({
                user_id: targetUserId,
                username: targetUsername,
                balance: newBalance
            }, { onConflict: 'user_id' });

            if (error) {
                console.error('❌ Supabase error:', error);
                await message.reply('❌ Database update failed.');
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
