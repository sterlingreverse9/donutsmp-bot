const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser, evaluateMartingaleAndGetWinRate, processBet } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGameCommands(command, args, message, prefix) {
    try {
        if (['cf', 'coinflip'].includes(command)) {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const choice = args[0] ? args[0].toLowerCase() : null;
            const betAmount = parseAmount(args[1]);

            if (!['heads', 'tails', 'h', 't'].includes(choice) || !betAmount || betAmount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}cf <heads/tails> <amount>\``);
                return true;
            }

            if (user.balance < betAmount) {
                await message.reply(`❌ Insufficient balance! Your balance: **$${user.balance.toLocaleString()}**`);
                return true;
            }

            const { data: setting } = await supabase.from('game_settings').select('win_rate').eq('game_name', 'coinflip').single();
            const baseRate = setting ? setting.win_rate : 48;

            const effectiveWinRate = await evaluateMartingaleAndGetWinRate(user, betAmount, baseRate);
            const roll = Math.random() * 100;
            const isWin = roll <= effectiveWinRate;

            const newBalance = isWin ? user.balance + betAmount : user.balance - betAmount;

            await supabase.from('balances').update({ balance: newBalance }).eq('user_id', user.user_id);
            await processBet(user, betAmount, isWin);

            const chosenSide = choice.startsWith('h') ? 'Heads' : 'Tails';
            const outcomeSide = isWin ? chosenSide : (chosenSide === 'Heads' ? 'Tails' : 'Heads');

            const embed = new EmbedBuilder()
                .setTitle(isWin ? '🪙 Coinflip — YOU WON!' : '🪙 Coinflip — YOU LOST!')
                .setColor(isWin ? 0x2ecc71 : 0xe74c3c)
                .addFields(
                    { name: 'Choice', value: chosenSide, inline: true },
                    { name: 'Landed On', value: outcomeSide, inline: true },
                    { name: 'Result', value: isWin ? `+$${betAmount.toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}` }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }

        if (command === 'limbo') {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const betAmount = parseAmount(args[0]);
            const targetMultiplier = parseFloat(args[1]);

            if (!betAmount || !targetMultiplier || betAmount <= 0 || targetMultiplier < 1.01) {
                await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` (e.g., \`${prefix}limbo 100k 2.0\`)`);
                return true;
            }

            if (user.balance < betAmount) {
                await message.reply(`❌ Insufficient balance! Balance: **$${user.balance.toLocaleString()}**`);
                return true;
            }

            const houseEdge = 0.05;
            const resultMultiplier = Math.max(1.0, parseFloat(((100 - houseEdge) / (Math.random() * 99 + 1)).toFixed(2)));
            const isWin = resultMultiplier >= targetMultiplier;

            const profit = Math.floor(betAmount * (targetMultiplier - 1));
            const newBalance = isWin ? user.balance + profit : user.balance - betAmount;

            await supabase.from('balances').update({ balance: newBalance }).eq('user_id', user.user_id);
            await processBet(user, betAmount, isWin);

            const embed = new EmbedBuilder()
                .setTitle(isWin ? '🚀 Limbo — WIN!' : '🚀 Limbo — CRASHED!')
                .setColor(isWin ? 0x2ecc71 : 0xe74c3c)
                .addFields(
                    { name: 'Target Multiplier', value: `${targetMultiplier.toFixed(2)}x`, inline: true },
                    { name: 'Result Multiplier', value: `${resultMultiplier.toFixed(2)}x`, inline: true },
                    { name: 'Result', value: isWin ? `+$${profit.toLocaleString()}` : `-$${betAmount.toLocaleString()}`, inline: true },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}` }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error inside handleGameCommands:', err);
        await message.reply('❌ Failed to process game command. Check bot logs.');
        return true;
    }
}

module.exports = { handleGameCommands };
