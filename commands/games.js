const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

// Utility delay for suspense animation
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleGameCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        const username = message.author.username;
        const user = await getOrCreateUser(userId, username);

        // --- LIMBO COMMAND ---
        if (['limbo', 'lb'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` or \`${prefix}limbo <multiplier> <amount>\`\n*Example:* \`${prefix}limbo 1m 1.5x\``);
                return true;
            }

            let rawMultiplier, rawAmount;

            // Flexible order detection: check which argument contains 'x' or a decimal multiplier
            if (args[0].toLowerCase().includes('x') || (!isNaN(parseFloat(args[0])) && parseFloat(args[0]) > 1 && !args[0].toLowerCase().includes('k') && !args[0].toLowerCase().includes('m'))) {
                rawMultiplier = args[0];
                rawAmount = args[1];
            } else {
                rawAmount = args[0];
                rawMultiplier = args[1];
            }

            const cleanMultiplier = parseFloat(rawMultiplier.replace(/x/gi, ''));
            const betAmount = parseAmount(rawAmount);

            if (isNaN(cleanMultiplier) || cleanMultiplier <= 1.01) {
                await message.reply('❌ **Target multiplier must be a number greater than 1.01x.**');
                return true;
            }

            if (!betAmount || betAmount <= 0) {
                await message.reply(`❌ **Invalid bet amount.** Usage: \`${prefix}limbo <amount> <multiplier>\``);
                return true;
            }

            if ((user?.balance || 0) < betAmount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${(user?.balance || 0).toLocaleString()}**`);
                return true;
            }

            // Get game settings from DB
            const { data: settings } = await supabase.from('game_settings').select('*').eq('game_name', 'limbo').single();
            const winChance = settings?.win_chance !== undefined ? settings.win_chance : 45;

            const isWin = (Math.random() * 100) < winChance;
            let rolledMultiplier;

            if (isWin) {
                rolledMultiplier = (cleanMultiplier + (Math.random() * cleanMultiplier)).toFixed(2);
            } else {
                rolledMultiplier = (1.00 + Math.random() * (cleanMultiplier - 1.01)).toFixed(2);
            }

            const won = parseFloat(rolledMultiplier) >= cleanMultiplier;
            let newBalance = user.balance;
            let rakebackAdded = 0;

            if (won) {
                const profit = betAmount * (cleanMultiplier - 1);
                newBalance += profit;
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
                .setColor(won ? '#2ECC71' : '#E74C3C')
                .setTitle(won ? '🚀 Limbo — YOU WON!' : '💥 Limbo — CRASHED!')
                .addFields(
                    { name: 'Target', value: `${cleanMultiplier}x`, inline: true },
                    { name: 'Rolled', value: `${rolledMultiplier}x`, inline: true },
                    { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true },
                    { name: won ? 'Profit' : 'Loss', value: won ? `+$${(betAmount * (cleanMultiplier - 1)).toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- COINFLIP COMMAND (WITH ANIMATED SUSPENSE UI) ---
        if (['cf', 'coinflip'].includes(command)) {
            const side = args[0]?.toLowerCase();
            const betAmount = parseAmount(args[1]);

            if (!['heads', 'tails', 'h', 't'].includes(side) || !betAmount || betAmount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}cf <heads/tails> <amount>\`\n*Example:* \`${prefix}cf heads 100k\``);
                return true;
            }

            const chosenSide = ['heads', 'h'].includes(side) ? 'heads' : 'tails';

            if ((user?.balance || 0) < betAmount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${(user?.balance || 0).toLocaleString()}**`);
                return true;
            }

            // Suspense UI Step 1: Send spinning state
            const spinningEmbed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('🪙 Coinflip — Flipping...')
                .setDescription(`*Flipping the coin for **$${betAmount.toLocaleString()}** on **${chosenSide.toUpperCase()}**...*`)
                .setImage('https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHY1dmpyNXFiMXB5M2sxaHNjYW1wcTh3a3M1MWtzZWtsazQ2b3M1ZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3o7TKTDn9761Z8Yn28/giphy.gif')
                .setFooter({ text: 'Donut Bet Bot' });

            const gameMsg = await message.reply({ embeds: [spinningEmbed] });

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

            // Wait 2 seconds for suspense
            await sleep(2000);

            // Suspense UI Step 2: Reveal outcome
            const resultEmbed = new EmbedBuilder()
                .setColor(isWin ? '#2ECC71' : '#E74C3C')
                .setTitle(isWin ? '🪙 Coinflip — YOU WON!' : '🪙 Coinflip — YOU LOST!')
                .addFields(
                    { name: 'Choice', value: chosenSide.toUpperCase(), inline: true },
                    { name: 'Landed On', value: landedOn.toUpperCase(), inline: true },
                    { name: 'Result', value: isWin ? `+$${betAmount.toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await gameMsg.edit({ embeds: [resultEmbed] }).catch(() => {});
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in game handler:', err);
        return false;
    }
}

module.exports = { handleGameCommands };
