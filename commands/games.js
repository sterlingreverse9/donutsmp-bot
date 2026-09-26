const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Exact Table-Based Win Probability lookup for Limbo
function getLimboWinChance(target) {
    if (target >= 1.01 && target <= 1.10) return 89.11 - ((target - 1.01) / 0.09) * (89.11 - 81.82);
    if (target > 1.10 && target <= 1.20) return 81.08 - ((target - 1.11) / 0.09) * (81.08 - 75.00);
    if (target > 1.20 && target <= 1.50) return 74.38 - ((target - 1.21) / 0.29) * (74.38 - 60.00);
    if (target > 1.50 && target <= 2.00) return 59.60 - ((target - 1.51) / 0.49) * (59.60 - 45.00);
    if (target > 2.00 && target <= 2.50) return 44.78 - ((target - 2.01) / 0.49) * (44.78 - 36.00);
    if (target > 2.50 && target <= 3.00) return 35.86 - ((target - 2.51) / 0.49) * (35.86 - 30.00);
    if (target > 3.00 && target <= 4.00) return 29.90 - ((target - 3.01) / 0.99) * (29.90 - 22.50);
    if (target > 4.00 && target <= 5.00) return 22.44 - ((target - 4.01) / 0.99) * (22.44 - 18.00);
    if (target > 5.00 && target <= 7.50) return 17.96 - ((target - 5.01) / 2.49) * (17.96 - 12.00);
    if (target > 7.50 && target <= 10.00) return 11.98 - ((target - 7.51) / 2.49) * (11.98 - 9.00);
    if (target > 10.00 && target <= 20.00) return 8.99 - ((target - 10.01) / 9.99) * (8.99 - 4.50);
    if (target > 20.00 && target <= 50.00) return 4.50 - ((target - 20.01) / 29.99) * (4.50 - 1.80);
    if (target > 50.00 && target <= 100.00) return 1.80 - ((target - 50.01) / 49.99) * (1.80 - 0.90);
    return 0.85; // <0.90% for 100x+
}

async function handleGameCommands(command, args, message, prefix) {
    try {
        const userId = message.author.id;
        const username = message.author.username;
        const user = await getOrCreateUser(userId, username);

        // --- LIMBO COMMAND ---
        if (['limbo', 'lb'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` or \`${prefix}limbo <multiplier> <amount>\`\n*Example:* \`${prefix}limbo 100k 2x\``);
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

            // Bounds restriction: strictly 1.01x to 100x
            if (isNaN(targetMultiplier) || targetMultiplier < 1.01 || targetMultiplier > 100) {
                await message.reply('❌ **Target multiplier must be between 1.01x and 100x.**');
                return true;
            }

            if (!betAmount || betAmount <= 0) {
                await message.reply(`❌ **Invalid bet amount.**`);
                return true;
            }

            if ((user?.balance || 0) < betAmount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${(user?.balance || 0).toLocaleString()}**`);
                return true;
            }

            const winChancePercent = getLimboWinChance(targetMultiplier);
            const won = (Math.random() * 100) < winChancePercent;

            let finalRolled;
            if (won) {
                // Natural winning roll above target
                const extra = Math.random() * (100 - targetMultiplier) * 0.2;
                finalRolled = (targetMultiplier + extra).toFixed(2);
            } else {
                // Natural losing crash below target
                if (targetMultiplier <= 1.05) {
                    finalRolled = "1.00";
                } else {
                    const lossVal = 1.00 + Math.random() * (targetMultiplier - 1.01);
                    finalRolled = lossVal.toFixed(2);
                }
            }

            const targetRolled = parseFloat(finalRolled);

            let newBalance = user.balance;
            let rakebackAdded = 0;
            const profitLoss = won ? betAmount * (targetMultiplier - 1) : -betAmount;

            if (won) {
                newBalance += profitLoss;
            } else {
                newBalance -= betAmount;
                rakebackAdded = betAmount * 0.01;
            }

            const newWagerReq = Math.max(0, (user.wager_required || 0) - betAmount);
            const newTotalWagered = (user.total_wagered || 0) + betAmount;

            await supabase.from('balances').upsert({
                user_id: userId,
                username: username,
                balance: newBalance,
                rakeback: (user.rakeback || 0) + rakebackAdded,
                wager_required: newWagerReq,
                total_wagered: newTotalWagered
            }, { onConflict: 'user_id' });

            // Log game for profile stats
            await supabase.from('game_logs').insert({
                user_id: userId,
                game_name: 'Limbo',
                bet_amount: betAmount,
                profit_loss: profitLoss,
                won: won
            });

            // --- ANIMATION UI ---
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

            const curveSteps = [0.20, 0.50, 0.80, 1.0];
            for (const progress of curveSteps) {
                await sleep(350);
                const currentStepVal = (1.00 + (targetRolled - 1.00) * Math.pow(progress, 2)).toFixed(2);

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

            const finalEmbed = new EmbedBuilder()
                .setColor(won ? '#2ECC71' : '#E74C3C')
                .setTitle(won ? '🚀 Limbo — YOU WON!' : '💥 Limbo — CRASHED!')
                .addFields(
                    { name: 'Target', value: `${targetMultiplier}x`, inline: true },
                    { name: 'Rolled', value: `${targetRolled.toFixed(2)}x`, inline: true },
                    { name: 'Bet Amount', value: `$${betAmount.toLocaleString()}`, inline: true },
                    { name: won ? 'Profit' : 'Loss', value: won ? `+$${profitLoss.toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
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

            // Fetch custom win chance dynamically set by /wincf
            const { data: settings } = await supabase.from('game_settings').select('*').eq('game_name', 'cf').single();
            const winChance = settings?.win_chance !== undefined ? settings.win_chance : 45;

            const isWin = (Math.random() * 100) < winChance;
            const landedOn = isWin ? chosenSide : (chosenSide === 'heads' ? 'tails' : 'heads');

            let newBalance = user.balance;
            let rakebackAdded = 0;
            const profitLoss = isWin ? betAmount : -betAmount;

            if (isWin) {
                newBalance += betAmount;
            } else {
                newBalance -= betAmount;
                rakebackAdded = betAmount * 0.01;
            }

            const newWagerReq = Math.max(0, (user.wager_required || 0) - betAmount);
            const newTotalWagered = (user.total_wagered || 0) + betAmount;

            await supabase.from('balances').upsert({
                user_id: userId,
                username: username,
                balance: newBalance,
                rakeback: (user.rakeback || 0) + rakebackAdded,
                wager_required: newWagerReq,
                total_wagered: newTotalWagered
            }, { onConflict: 'user_id' });

            // Log game for profile stats
            await supabase.from('game_logs').insert({
                user_id: userId,
                game_name: 'Coinflip',
                bet_amount: betAmount,
                profit_loss: profitLoss,
                won: isWin
            });

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
