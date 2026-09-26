const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleGameCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        const username = message.author.username;
        const user = await getOrCreateUser(userId, username);

        // --- LIMBO COMMAND ---
        if (['limbo', 'lb'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` or \`${prefix}limbo <multiplier> <amount>\`\n*Example:* \`${prefix}limbo 100k 10x\``);
                return true;
            }

            let rawMultiplier, rawAmount;

            // Detect flexible argument positioning
            if (args[0].toLowerCase().includes('x') || (!isNaN(parseFloat(args[0])) && parseFloat(args[0]) > 1 && !args[0].toLowerCase().includes('k') && !args[0].toLowerCase().includes('m'))) {
                rawMultiplier = args[0];
                rawAmount = args[1];
            } else {
                rawAmount = args[0];
                rawMultiplier = args[1];
            }

            const targetMultiplier = parseFloat(rawMultiplier.replace(/x/gi, ''));
            const betAmount = parseAmount(rawAmount);

            // Bounds restriction check (1.01x to 100x)
            if (isNaN(targetMultiplier) || targetMultiplier < 1.01 || targetMultiplier > 100) {
                await message.reply('❌ **Target multiplier must be between 1.01x and 100x.**');
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

            // --- PURE PARETO LIMBO CURVE MATH (10% HOUSE EDGE) ---
            const houseEdgeFactor = 0.90; // 10% House Edge
            const u = Math.random(); // Uniform distribution [0, 1)

            // Inverse transform sampling formula for exponential probability decay curve
            let rawRolled = houseEdgeFactor / (1 - u);

            // Hard limits: min 1.00x, max capped at 100x target range
            if (rawRolled < 1.00) rawRolled = 1.00;
            if (rawRolled > 100) rawRolled = 100;

            const targetRolled = parseFloat(rawRolled.toFixed(2));
            const won = targetRolled >= targetMultiplier;

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

            // --- ANIMATED EXPONENTIAL COUNT-UP UI ---
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

            // Smooth cubic progression steps matching the exponential curve visual
            const curveSteps = [0.20, 0.50, 0.80, 1.0];
            for (const progress of curveSteps) {
                await sleep(350);

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

            await sleep(250);

            // Final Result Reveal
            const finalEmbed = new EmbedBuilder()
                .setColor(won ? '#2ECC71' : '#E74C3C')
                .setTitle(won ? '🚀 Limbo — YOU WON!' : '💥 Limbo — CRASHED!')
                .addFields(
                    { name: 'Target', value: `${targetMultiplier}x`, inline: true },
                    { name: 'Rolled', value: `${targetRolled.toFixed(2)}x`, inline: true },
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
                await sleep(350);

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

            await sleep(350);

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
