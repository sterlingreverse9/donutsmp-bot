const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleGameCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        const username = message.author.username;
        const user = await getOrCreateUser(userId, username);

        // --- LIMBO COMMAND (10% HOUSE EDGE & SMOOTH CURVE) ---
        if (['limbo', 'lb'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` or \`${prefix}limbo <multiplier> <amount>\`\n*Example:* \`${prefix}limbo 100k 10x\``);
                return true;
            }

            let rawMultiplier, rawAmount;

            if (args[0].toLowerCase().includes('x') || (!isNaN(parseFloat(args[0])) && parseFloat(args[0]) > 1 && !args[0].toLowerCase().includes('k') && !args[0].toLowerCase().includes('m'))) {
                rawMultiplier = args[0];
                rawAmount = args[1];
            } else {
                rawAmount = args[0];
                rawMultiplier = args[1];
            }

            const targetMultiplier = parseFloat(rawMultiplier.replace(/x/gi, ''));
            const betAmount = parseAmount(rawAmount);

            if (isNaN(targetMultiplier) || targetMultiplier <= 1.01) {
                await message.reply('❌ **Target multiplier must be greater than 1.01x.**');
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

            // --- REALISTIC LIMBO MATH (10% HOUSE EDGE) ---
            // House Edge = 10% => Multiplier Scale = 0.90
            const houseEdgeFactor = 0.90;
            const trueWinProbability = houseEdgeFactor / targetMultiplier; // e.g. 10x target -> 0.09 (9% chance)

            const randomValue = Math.random(); // Range: 0.0 to 1.0
            const won = randomValue < trueWinProbability;

            let finalRolled;
            if (won) {
                // Generates smooth winning multiplier above target
                const maxWinMultiplier = targetMultiplier * 1.5;
                finalRolled = (targetMultiplier + Math.random() * (maxWinMultiplier - targetMultiplier)).toFixed(2);
            } else {
                // Multiplier crashes below target curve
                const rolledValue = Math.max(1.00, 1.00 / (1.00 - (randomValue * houseEdgeFactor)));
                finalRolled = Math.min(rolledValue, targetMultiplier - 0.01).toFixed(2);
            }

            const targetRolled = parseFloat(finalRolled);

            let newBalance = user.balance;
            let rakebackAdded = 0;

            if (won) {
                const profit = betAmount * (targetMultiplier - 1);
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

            // --- ANIMATED COUNT-UP (SMOOTH CUBIC CURVE) ---
            const initialEmbed = new EmbedBuilder()
                .setColor('#F39C12')
                .setTitle('🚀 Limbo — Launching...')
                .addFields(
                    { name: 'Target', value: `${targetMultiplier}x`, inline: true },
                    { name: 'Current Multiplier', value: `\`1.00x\``, inline: true },
                    { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            const gameMsg = await message.reply({ embeds: [initialEmbed] });

            // 5 Smooth count steps
            const curveSteps = [0.15, 0.35, 0.60, 0.85, 1.0];
            for (const progress of curveSteps) {
                await sleep(400);

                // Cubic ease-out curve calculation
                const currentStepVal = (1.00 + (targetRolled - 1.00) * Math.pow(progress, 3)).toFixed(2);

                const stepEmbed = new EmbedBuilder()
                    .setColor('#F39C12')
                    .setTitle('🚀 Limbo — Climbing...')
                    .addFields(
                        { name: 'Target', value: `${targetMultiplier}x`, inline: true },
                        { name: 'Current Multiplier', value: `\`${currentStepVal}x\``, inline: true },
                        { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Donut Bet Bot' });

                await gameMsg.edit({ embeds: [stepEmbed] }).catch(() => {});
            }

            await sleep(300);

            // Final Reveal
            const finalEmbed = new EmbedBuilder()
                .setColor(won ? '#2ECC71' : '#E74C3C')
                .setTitle(won ? '🚀 Limbo — YOU WON!' : '💥 Limbo — CRASHED!')
                .addFields(
                    { name: 'Target', value: `${targetMultiplier}x`, inline: true },
                    { name: 'Rolled', value: `${finalRolled}x`, inline: true },
                    { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true },
                    { name: won ? 'Profit' : 'Loss', value: won ? `+$${(betAmount * (targetMultiplier - 1)).toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await gameMsg.edit({ embeds: [finalEmbed] }).catch(() => {});
            return true;
        }

        // --- COINFLIP COMMAND ---
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

            const flipEmbed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('🪙 Coinflip — Flipping...')
                .setDescription(`*Flipping for **$${betAmount.toLocaleString()}** on **${chosenSide.toUpperCase()}**...*`)
                .addFields({ name: 'State', value: '🌀 `HEADS`', inline: true })
                .setFooter({ text: 'Donut Bet Bot' });

            const gameMsg = await message.reply({ embeds: [flipEmbed] });

            const shuffleStates = ['🌀 `TAILS`', '🌀 `HEADS`', '🌀 `TAILS`'];
            for (const stateText of shuffleStates) {
                await sleep(400);

                const shuffleEmbed = new EmbedBuilder()
                    .setColor('#F1C40F')
                    .setTitle('🪙 Coinflip — Flipping...')
                    .setDescription(`*Flipping for **$${betAmount.toLocaleString()}** on **${chosenSide.toUpperCase()}**...*`)
                    .addFields({ name: 'State', value: stateText, inline: true })
                    .setFooter({ text: 'Donut Bet Bot' });

                await gameMsg.edit({ embeds: [shuffleEmbed] }).catch(() => {});
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

            await sleep(400);

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
