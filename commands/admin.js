const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

// Add your Discord User ID(s) here (e.g. ['123456789012345678']) or leave [] for all
const ADMIN_IDS = [];

async function handleAdminCommands(command, args, message, prefix) {
    try {
        // --- ADD BALANCE & DEDUCT BALANCE COMMANDS ---
        if (['addbalance', 'addbal', 'deductbalance', 'deductbal'].includes(command)) {
            if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(message.author.id)) {
                await message.reply('❌ You do not have permission to use admin balance commands.');
                return true;
            }

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

        // --- APPROVE WITHDRAWAL COMMAND ---
        if (['approvewd', 'declinewd'].includes(command)) {
            if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(message.author.id)) {
                await message.reply('❌ You do not have permission to handle withdrawals.');
                return true;
            }

            if (args.length < 1) {
                await message.reply(`❌ **Usage:** \`${prefix}${command} <Withdrawal_ID>\`\n*Example:* \`${prefix}approvewd WD-802795\``);
                return true;
            }

            const reqId = args[0].toUpperCase().trim();
            const isApprove = command === 'approvewd';

            // Fetch pending withdrawal request from Supabase
            const { data: request, error: fetchErr } = await supabase
                .from('withdrawals')
                .select('*')
                .eq('request_id', reqId)
                .single();

            if (fetchErr || !request) {
                await message.reply(`❌ Withdrawal request **${reqId}** was not found.`);
                return true;
            }

            if (request.status !== 'pending') {
                await message.reply(`⚠️ Request **${reqId}** has already been processed (${request.status}).`);
                return true;
            }

            if (isApprove) {
                // Update status to approved
                await supabase.from('withdrawals').update({ status: 'approved' }).eq('request_id', reqId);

                const embed = new EmbedBuilder()
                    .setTitle('✅ Withdrawal Approved')
                    .setColor('#2ECC71')
                    .addFields(
                        { name: 'Request ID', value: `\`${reqId}\``, inline: true },
                        { name: 'User', value: `<@${request.user_id}>`, inline: true },
                        { name: 'MC IGN', value: `\`${request.mc_ign || 'N/A'}\``, inline: true },
                        { name: 'Amount Approved', value: `$${request.amount.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Staff Panel' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            } else {
                // Return balance to user if declined
                const user = await getOrCreateUser(request.user_id, request.username);
                const restoredBalance = (user.balance || 0) + request.amount;

                await supabase.from('balances').update({ balance: restoredBalance }).eq('user_id', request.user_id);
                await supabase.from('withdrawals').update({ status: 'declined' }).eq('request_id', reqId);

                const embed = new EmbedBuilder()
                    .setTitle('❌ Withdrawal Declined')
                    .setColor('#E74C3C')
                    .addFields(
                        { name: 'Request ID', value: `\`${reqId}\``, inline: true },
                        { name: 'User', value: `<@${request.user_id}>`, inline: true },
                        { name: 'Refunded Amount', value: `$${request.amount.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Staff Panel' })
                    .setTimestamp();

                await message.reply({ embeds: [embed] });
            }

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
