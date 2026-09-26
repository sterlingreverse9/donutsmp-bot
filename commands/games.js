const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGameCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        const username = message.author.username;
        const user = await getOrCreateUser(userId, username);

        // --- LIMBO COMMAND ---
        if (['limbo', 'lb'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <target_multiplier> <bet_amount>\`\n*Example:* \`${prefix}limbo 5x 100k\` or \`${prefix}limbo 5 100k\``);
                return true;
            }

            // Clean multiplier input (strip 'x' or 'X' if present)
            const rawMultiplier = args[0].replace(/x/gi, '');
            const targetMultiplier = parseFloat(rawMultiplier);

            // Parse bet amount
            const betAmount = parseAmount(args[1]);

            if (isNaN(targetMultiplier) || targetMultiplier <= 1.01) {
                await message.reply('❌ Target multiplier must be a number greater than **1.01x**.');
                return true;
            }

            if (!betAmount || betAmount <= 0) {
                await message.reply(`❌ Invalid bet amount. Usage: \`${prefix}limbo <multiplier> <amount>\``);
                return true;
            }

            if ((user?.balance || 0) < betAmount) {
                await message.reply(`❌ You don't have enough balance! Current balance: **$${(user?.balance || 0).toLocaleString()}**`);
                return true;
            }

            // Fetch game odds settings from Supabase (defaulting to 45% win chance)
            const { data: settings } = await supabase.from('game_settings').select('*').eq('game_name', 'limbo').single();
            const configuredWinChance = settings?.win_chance !== undefined ? settings.win_chance : 45;

            // Generate rolled multiplier based on configured probability
            const isWinRoll = (Math.random() * 100) < configuredWinChance;
            let rolledMultiplier;

            if (isWinRoll) {
                // Roll higher than target
                rolledMultiplier = (targetMultiplier + (Math.random() * targetMultiplier)).toFixed(2);
            } else {
                // Roll lower than target
                rolledMultiplier = (1.00 + Math.random() * (targetMultiplier - 1.01)).toFixed(2);
            }

            const won = parseFloat(rolledMultiplier) >= targetMultiplier;
            let newBalance = user.balance;
            let rakebackAdded = 0;

            if (won) {
                const profit = betAmount * (targetMultiplier - 1);
                newBalance += profit;
            } else {
                newBalance -= betAmount;
                // Add 1% loss rakeback
                rakebackAdded = betAmount * 0.01;
            }

            // Deduct required wager
            const newWagerReq = Math.max(0, (user.wager_required || 0) - betAmount);

            // Update user balance in Supabase
            await supabase.from('balances').update({
                balance: newBalance,
                rakeback: (user.rakeback || 0) + rakebackAdded,
                wager_required: newWagerReq
            }).eq('user_id', userId);

            const embed = new EmbedBuilder()
                .setColor(won ? '#2ECC71' : '#E74C3C')
                .setTitle(won ? '🚀 Limbo — YOU WON!' : '💥 Limbo — CRASHED!')
                .addFields(
                    { name: 'Target', value: `${targetMultiplier}x`, inline: true },
                    { name: 'Rolled', value: `${rolledMultiplier}x`, inline: true },
                    { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true },
                    { name: won ? 'Profit' : 'Loss', value: won ? `+$${(betAmount * (targetMultiplier - 1)).toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- COINFLIP COMMAND ---
        if (['cf', 'coinflip'].includes(command)) {
            const side = args[0]?.toLowerCase();
            const betAmount = parseAmount(args[1]);

            if (!['heads', 'tails', 'h', 't'].includes(side) || !betAmount || betAmount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}cf <heads/tails> <amount>\`\n*Example:* \`${prefix}cf tails 100k\``);
                return true;
            }

            const chosenSide = ['heads', 'h'].includes(side) ? 'heads' : 'tails';

            if ((user?.balance || 0) < betAmount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${(user?.balance || 0).toLocaleString()}**`);
                return true;
            }

            const { data: settings } = await supabase.from('game_settings').select('*').eq('game_name', 'cf').single();
            const winChance = settings?.win_chance !== undefined ? settings.win_chance : 45;

            const isWin = (Math.random() * 100) < winChance;
            const landedOn = isWin ? chosenSide : (chosenSide === 'heads' ? 'tails' : 'heads');

            let newBalance = user.balance;
            let rakebackAdded = 0;

            if (isWin) {
                newBalance += betAmount;
            } else {
                newBalance -= betAmount;
                rakebackAdded = betAmount * 0.01;
            }

            const newWagerReq = Math.max(0, (user.wager_required || 0) - betAmount);

            await supabase.from('balances').update({
                balance: newBalance,
                rakeback: (user.rakeback || 0) + rakebackAdded,
                wager_required: newWagerReq
            }).eq('user_id', userId);

            const embed = new EmbedBuilder()
                .setColor(isWin ? '#2ECC71' : '#E74C3C')
                .setTitle(isWin ? '🪙 Coinflip — YOU WON!' : '🪙 Coinflip — YOU LOST!')
                .addFields(
                    { name: 'Choice', value: chosenSide.toUpperCase(), inline: true },
                    { name: 'Landed On', value: landedOn.toUpperCase(), inline: true },
                    { name: 'Result', value: isWin ? `+$${betAmount.toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [embed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in game handler:', err);
        return false;
    }
}

module.exports = { handleGameCommands };
