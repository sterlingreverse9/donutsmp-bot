const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleUserCommands(command, args, message, prefix) {
    try {
        // --- LINK MINECRAFT IGN COMMAND ---
        if (['link', 'ign'].includes(command)) {
            if (args.length < 1) {
                await message.reply(`❌ **Usage:** \`${prefix}link <Minecraft_IGN>\``);
                return true;
            }

            const ign = args[0].trim();
            const user = await getOrCreateUser(message.author.id, message.author.username);

            await supabase.from('balances').upsert({
                user_id: message.author.id,
                username: message.author.username,
                mc_ign: ign
            }, { onConflict: 'user_id' });

            await message.reply(`✅ Linked your Minecraft username to **${ign}**!`);
            return true;
        }

        // --- WITHDRAW COMMAND ---
        if (['withdraw', 'wd'].includes(command)) {
            if (args.length < 1) {
                await message.reply(`❌ **Usage:** \`${prefix}withdraw <amount>\`\n*Example:* \`${prefix}withdraw 1.15m\``);
                return true;
            }

            const amount = parseAmount(args[0]);
            if (!amount || amount <= 0) {
                await message.reply('❌ Invalid withdrawal amount specified.');
                return true;
            }

            const user = await getOrCreateUser(message.author.id, message.author.username);
            const currentBal = user.balance || 0;

            if (currentBal < amount) {
                await message.reply(`❌ Insufficient balance! Your current balance is **$${currentBal.toLocaleString()}**.`);
                return true;
            }

            if ((user.wager_required || 0) > 0) {
                await message.reply(`❌ You must complete **$${user.wager_required.toLocaleString()}** in wagers before withdrawing.`);
                return true;
            }

            const reqId = `WD-${Math.floor(100000 + Math.random() * 900000)}`;
            const newBal = currentBal - amount;

            // Deduct balance immediately & save request
            await supabase.from('balances').update({ balance: newBal }).eq('user_id', message.author.id);
            await supabase.from('withdrawals').insert([{
                request_id: reqId,
                user_id: message.author.id,
                username: message.author.username,
                mc_ign: user.mc_ign || 'Not Linked',
                amount: amount,
                status: 'pending'
            }]);

            const embed = new EmbedBuilder()
                .setTitle(`📤 New Withdrawal Request (#${reqId})`)
                .setColor('#F39C12')
                .addFields(
                    { name: 'User', value: `${message.author.username} (<@${message.author.id}>)`, inline: false },
                    { name: 'MC IGN', value: user.mc_ign || 'Not Linked', inline: true },
                    { name: 'Amount', value: `$${amount.toLocaleString()}`, inline: true },
                    { name: 'Approval Commands', value: `\`!approvewd ${reqId}\` | \`!declinewd ${reqId}\``, inline: false }
                )
                .setFooter({ text: 'Donut Bet Bot' })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in user command handler:', err);
        await message.reply('❌ An error occurred processing your request.').catch(() => {});
        return true;
    }
}

module.exports = { handleUserCommands };
