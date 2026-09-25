const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser, evaluateMartingaleAndGetWinRate, processBet } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGameCommands(command, args, message, prefix) {
    const user = await getOrCreateUser(message.author.id, message.author.username);

    if (command === 'coinflip' || command === 'cf') {
        const choice = args[0] ? args[0].toLowerCase() : null;
        const betAmount = parseAmount(args[1]);

        if (!['heads', 'tails', 'h', 't'].includes(choice) || !betAmount || betAmount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}cf <heads/tails> <amount>\``);
        }

        if (user.balance < betAmount) {
            return message.reply(`❌ Insufficient balance! Your balance: **$${user.balance.toLocaleString()}**`);
        }

        // Fetch global win rate setting or default to 48%
        const { data: setting } = await supabase.from('game_settings').select('win_rate').eq('game_name', 'coinflip').single();
        const baseRate = setting ? setting.win_rate : 48;

        // Apply anti-martingale penalty adjustment
        const effectiveWinRate = await evaluateMartingaleAndGetWinRate(user, betAmount, baseRate);
        const roll = Math.random() * 100;
        const isWin = roll <= effectiveWinRate;

        let newBalance = user.balance;
        if (isWin) {
            newBalance += betAmount;
        } else {
            newBalance -= betAmount;
        }

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
                { name: 'Result', value: isWin ? `+ $${betAmount.toLocaleString()}` : `- $${betAmount.toLocaleString()}`, inline: true },
                { name: 'New Balance', value: `$${newBalance.toLocaleString()}` }
            );

        return message.reply({ embeds: [embed] });
    }

    return false;
}

module.exports = { handleGameCommands };
