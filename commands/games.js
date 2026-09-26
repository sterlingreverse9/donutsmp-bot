const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGameCommands(command, args, message, prefix) {
    try {
        // --- LIMBO GAME COMMAND ---
        if (['limbo', 'lb'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <target_multiplier>\`\n*Example:* \`${prefix}limbo 500k 1.45\``);
                return true;
            }

            let raw1 = args[0].toLowerCase().replace('x', '');
            let raw2 = args[1].toLowerCase().replace('x', '');

            let betAmount = parseAmount(raw1);
            let targetMulti = parseFloat(raw2);

            // Handle swapped inputs (e.g. !limbo 1.45x 500k)
            if (!betAmount || isNaN(targetMulti)) {
                betAmount = parseAmount(raw2);
                targetMulti = parseFloat(raw1);
            }

            if (!betAmount || betAmount <= 0) {
                await message.reply('❌ **Invalid bet amount.**');
                return true;
            }

            if (isNaN(targetMulti) || targetMulti < 1.01 || targetMulti > 1000000) {
                await message.reply('❌ **Target multiplier must be between 1.01x and 1,000,000x.**');
                return true;
            }

            const user = await getOrCreateUser(message.author.id, message.author.username);
            if ((user.balance || 0) < betAmount) {
                await message.reply(`❌ **Insufficient balance!** You have **$${(user.balance || 0).toLocaleString()}**.`);
                return true;
            }

            // Authentic Limbo random distribution with 1% House Edge
            const randomFloat = Math.random();
            let rolledMulti = parseFloat((0.99 / (1 - randomFloat)).toFixed(2));
            if (rolledMulti < 1.00) rolledMulti = 1.00;

            const isWin = rolledMulti >= targetMulti;

            let newBalance = user.balance;
            let newWager = Math.max(0, (user.wager_required || 0) - betAmount);
            let profit = 0;

            if (isWin) {
                profit = Math.floor(betAmount * (targetMulti - 1));
                newBalance += profit;
            } else {
                newBalance -= betAmount;
            }

            // Update user balance in database
            await supabase.from('balances').upsert({
                user_id: message.author.id,
                username: message.author.username,
                balance: newBalance,
                wager_required: newWager
            }, { onConflict: 'user_id' });

            // Send clean final result embed immediately
            const resultEmbed = new EmbedBuilder()
                .setTitle(isWin ? '🚀 Limbo — WINNER!' : '💥 Limbo — CRASHED!')
                .setColor(isWin ? '#2ECC71' : '#E74C3C')
                .addFields(
                    { name: 'Target', value: `${targetMulti.toFixed(2)}x`, inline: true },
                    { name: 'Rolled', value: `${rolledMulti.toFixed(2)}x`, inline: true },
                    { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true },
                    { name: isWin ? 'Profit' : 'Loss', value: isWin ? `+$${profit.toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' })
                .setTimestamp();

            await message.reply({ embeds: [resultEmbed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in game command:', err);
        await message.reply('❌ An error occurred while processing your bet. Please try again.').catch(() => {});
        return true;
    }
}

module.exports = { handleGameCommands };
