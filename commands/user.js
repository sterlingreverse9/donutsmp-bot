const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

const ADMIN_ID = '1453068990187438086';

async function handleUserCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        const username = message.author.username;
        const user = await getOrCreateUser(userId, username);

        // --- HELP COMMAND ---
        if (['help', 'h'].includes(command)) {
            const helpEmbed = new EmbedBuilder()
                .setColor('#3498DB')
                .setTitle('📜 Donut Bet Bot — Command List')
                .setDescription('Here are the available commands:\n\n' +
                    '**Games:**\n' +
                    `• \`${prefix}limbo <amount> <multiplier>\` - Play Limbo\n` +
                    `• \`${prefix}cf <heads/tails> <amount>\` - Play Coinflip\n\n` +
                    '**Account & Cashier:**\n' +
                    `• \`${prefix}profile\` or \`${prefix}me\` - View your stats & history\n` +
                    `• \`${prefix}link <mc_ign>\` - Link your Minecraft IGN\n` +
                    `• \`${prefix}unlink\` - Unlink your Minecraft IGN\n` +
                    `• \`${prefix}deposit <amount>\` - Deposit funds (Min: 1M)\n` +
                    `• \`${prefix}withdraw <amount>\` - Withdraw funds\n` +
                    `• \`${prefix}wager\` - Check remaining wager requirement\n` +
                    `• \`${prefix}tip @user <amount>\` - Transfer balance\n\n` +
                    '📞 **Need more help?** Contact **@piyushyadav83** for support!')
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [helpEmbed] });
            return true;
        }

        // --- BALANCE COMMAND ---
        if (['bal', 'balance'].includes(command)) {
            const balEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle(`💰 ${username}'s Balance`)
                .addFields(
                    { name: 'Balance', value: `$${(user.balance || 0).toLocaleString()}`, inline: true },
                    { name: 'Rakeback', value: `$${(user.rakeback || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Required', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [balEmbed] });
            return true;
        }

        // --- LINK MC COMMAND ---
        if (['link'].includes(command)) {
            const mcIgn = args[0];
            if (!mcIgn) {
                await message.reply(`❌ **Usage:** \`${prefix}link <Minecraft IGN>\``);
                return true;
            }

            await supabase.from('balances').upsert({
                user_id: userId,
                username: username,
                mc_ign: mcIgn
            }, { onConflict: 'user_id' });

            await message.reply(`✅ Linked your Minecraft username to **${mcIgn}**!`);
            return true;
        }

        // --- UNLINK MC COMMAND ---
        if (['unlink'].includes(command)) {
            if (!user.mc_ign) {
                await message.reply('❌ You do not have any Minecraft IGN linked.');
                return true;
            }

            const oldIgn = user.mc_ign;
            await supabase.from('balances').upsert({
                user_id: userId,
                username: username,
                mc_ign: null
            }, { onConflict: 'user_id' });

            await message.reply(`✅ **Unlinked Minecraft IGN:** \`${oldIgn}\``);
            return true;
        }

        // --- WAGER COMMAND ---
        if (['wager'].includes(command)) {
            const remaining = user.wager_required || 0;
            await message.reply(`🎰 **Remaining Wager Required:** $${remaining.toLocaleString()}`);
            return true;
        }

        // --- PROFILE / ME COMMAND ---
        if (['profile', 'me'].includes(command)) {
            const { data: logs } = await supabase.from('game_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
            const { data: allLogs } = await supabase.from('game_logs').select('profit_loss').eq('user_id', userId);

            const totalPL = allLogs ? allLogs.reduce((acc, row) => acc + parseFloat(row.profit_loss || 0), 0) : 0;
            const { data: refs } = await supabase.from('balances').select('user_id').eq('referred_by', userId);

            let historyText = logs && logs.length > 0 
                ? logs.map(l => `${l.won ? '🟩' : '🟥'} **${l.game_name}**: ${l.profit_loss >= 0 ? '+' : ''}$${l.profit_loss.toLocaleString()}`).join('\n')
                : 'No recent games played.';

            const profileEmbed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle(`👤 ${username}'s Profile`)
                .addFields(
                    { name: '🎮 Linked Minecraft IGN', value: user.mc_ign ? `\`${user.mc_ign}\`` : 'Not Linked (`!link <ign>`)', inline: true },
                    { name: '💰 Bot Balance', value: `$${(user.balance || 0).toLocaleString()}`, inline: true },
                    { name: '🎰 Remaining Wager', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true },
                    { name: '📊 Total Wagered', value: `$${(user.total_wagered || 0).toLocaleString()}`, inline: true },
                    { name: '📈 Overall Profit/Loss', value: `${totalPL >= 0 ? '🟢 +$' : '🔴 -$'}$${Math.abs(totalPL).toLocaleString()}`, inline: true },
                    { name: '👥 Referrals Count', value: `${refs ? refs.length : 0}`, inline: true },
                    { name: '📜 Recent Game History', value: historyText, inline: false }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [profileEmbed] });
            return true;
        }

        // --- DEPOSIT COMMAND ---
        if (['deposit', 'depo'].includes(command)) {
            if (!user.mc_ign) {
                await message.reply(`❌ **You must link your Minecraft IGN first using \`${prefix}link <mc_ign>\` before depositing!**`);
                return true;
            }

            const rawAmount = args[0];
            const amount = parseAmount(rawAmount);

            if (!amount || amount < 1000000) {
                await message.reply(`❌ **Minimum deposit amount is $1,000,000 (1M).** Usage: \`${prefix}deposit 1m\``);
                return true;
            }

            const depoId = 'DEP-' + Math.floor(100000 + Math.random() * 900000);

            await supabase.from('pending_deposits').insert({
                id: depoId,
                user_id: userId,
                username: username,
                amount: amount,
                status: 'pending_screenshot'
            });

            const depoEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle(`💳 Deposit Request #${depoId}`)
                .setDescription(`To complete your deposit of **$${amount.toLocaleString()}**:\n\n` +
                    `1. Pay **.fbfnch** in-game using: \`/pay .fbfnch ${amount}\`\n` +
                    `2. Take an **uncropped screenshot** of the payment transaction.\n` +
                    `3. Type \`${prefix}paid\` and attach your screenshot in this chat.\n\n` +
                    `*Need to cancel? Type \`${prefix}cancel\`*`)
                .addFields({ name: 'Linked IGN', value: `\`${user.mc_ign}\``, inline: true })
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [depoEmbed] });
            return true;
        }

        // --- PAID COMMAND ---
        if (['paid'].includes(command)) {
            const { data: activeDepo } = await supabase.from('pending_deposits')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'pending_screenshot')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (!activeDepo) {
                await message.reply(`❌ You are not doing a deposit right now. Start one using \`${prefix}deposit <amount>\``);
                return true;
            }

            const attachment = message.attachments.first();
            if (!attachment) {
                await message.reply('❌ **Please submit an uncropped screenshot of your payment along with `!paid`!** (Or type `!cancel` to cancel)');
                return true;
            }

            await supabase.from('pending_deposits').update({
                status: 'pending_approval',
                screenshot_url: attachment.url
            }).eq('id', activeDepo.id);

            await message.reply(`✅ **Deposit proof submitted!** ID: \`${activeDepo.id}\`. Please wait while our staff verifies your payment.`);

            try {
                const adminUser = await message.client.users.fetch(ADMIN_ID);
                const adminEmbed = new EmbedBuilder()
                    .setColor('#F1C40F')
                    .setTitle(`📥 New Deposit Submitted (#${activeDepo.id})`)
                    .addFields(
                        { name: 'User', value: `${username} (<@${userId}>)`, inline: true },
                        { name: 'MC IGN', value: `${user.mc_ign}`, inline: true },
                        { name: 'Amount', value: `$${activeDepo.amount.toLocaleString()}`, inline: true }
                    )
                    .setImage(attachment.url)
                    .setFooter({ text: `Approve: !approvedepo ${activeDepo.id} \vert{} Deny: !denydepo ${activeDepo.id}` });

                await adminUser.send({ embeds: [adminEmbed] });
            } catch (err) {}
            return true;
        }

        // --- CANCEL COMMAND ---
        if (['cancel'].includes(command)) {
            const { data: activeDepo } = await supabase.from('pending_deposits')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'pending_screenshot')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (!activeDepo) {
                await message.reply(`❌ You don't have any active deposit to cancel.`);
                return true;
            }

            await supabase.from('pending_deposits').update({ status: 'cancelled' }).eq('id', activeDepo.id);
            await message.reply('❌ **Deposit cancelled.**');
            return true;
        }

        // --- WITHDRAW COMMAND ---
        if (['withdraw', 'wd'].includes(command)) {
            if (!user.mc_ign) {
                await message.reply(`❌ **You must link your Minecraft IGN first using \`${prefix}link <mc_ign>\` before withdrawing!**`);
                return true;
            }

            const rawAmount = args[0];
            const amount = parseAmount(rawAmount);

            if (!amount || amount <= 0) {
                await message.reply(`❌ **Invalid withdrawal amount.** Usage: \`${prefix}withdraw <amount>\``);
                return true;
            }

            if ((user.balance || 0) < amount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${(user.balance || 0).toLocaleString()}**`);
                return true;
            }

            if ((user.wager_required || 0) > 0) {
                await message.reply(`❌ **You have uncleared wager requirement!** Remaining Wager: **$${(user.wager_required).toLocaleString()}**. Check using \`${prefix}wager\`.`);
                return true;
            }

            const wdId = 'WD-' + Math.floor(100000 + Math.random() * 900000);

            await supabase.from('balances').upsert({
                user_id: userId,
                username: username,
                balance: user.balance - amount
            }, { onConflict: 'user_id' });

            await supabase.from('pending_withdrawals').insert({
                id: wdId,
                user_id: userId,
                username: username,
                amount: amount,
                status: 'pending_confirmation'
            });

            await message.reply(`⚠️ **Do you really want to withdraw $${amount.toLocaleString()} to Minecraft IGN \`${user.mc_ign}\`?**\n*It may take up to 1 hour to receive in-game.*\n\nType \`!confirm\` to submit your request.`);
            return true;
        }

        // --- CONFIRM WITHDRAWAL COMMAND ---
        if (['confirm'].includes(command)) {
            const { data: activeWd } = await supabase.from('pending_withdrawals')
                .select('*')
                .eq('user_id', userId)
                .eq('status', 'pending_confirmation')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (!activeWd) {
                await message.reply(`❌ You are not doing a withdrawal right now. Start one using \`${prefix}withdraw <amount>\``);
                return true;
            }

            await supabase.from('pending_withdrawals').update({ status: 'pending_approval' }).eq('id', activeWd.id);
            await message.reply(`✅ **Withdrawal request submitted!** (ID: \`${activeWd.id}\`). Staff will pay you in-game shortly.`);

            try {
                const adminUser = await message.client.users.fetch(ADMIN_ID);
                const adminEmbed = new EmbedBuilder()
                    .setColor('#E67E22')
                    .setTitle(`📤 New Withdrawal Request (#${activeWd.id})`)
                    .addFields(
                        { name: 'User', value: `${username} (<@${userId}>)`, inline: true },
                        { name: 'MC IGN', value: `${user.mc_ign}`, inline: true },
                        { name: 'Amount', value: `$${activeWd.amount.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: `Approve: !approvewd ${activeWd.id} | Deny: !declinewd ${activeWd.id}` });

                await adminUser.send({ embeds: [adminEmbed] });
            } catch (err) {}
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in user command:', err);
        return false;
    }
}

module.exports = { handleUserCommands };
