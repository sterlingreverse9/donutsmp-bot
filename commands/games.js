const supabase = require('../config/supabase');
const { getOrCreateUser, parseAmount } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGameCommands(command, args, message, prefix) {
    try {
        // Handle Coinflip Aliases
        if (['cf', 'coin', 'coinflip'].includes(command)) {
            if (args.length < 2) {
                await message.reply(`❌ **Usage:** \`${prefix}cf <heads/tails> <amount>\` or \`${prefix}cf <amount> <heads/tails>\``);
                return true;
            }

            // Flexibly parse arguments regardless of order
            let choice = null;
            let rawAmount = null;

            for (const arg of args) {
                const cleanArg = arg.toLowerCase();
                if (['heads', 'head', 'h', 'tails', 'tail', 't'].includes(cleanArg)) {
                    choice = cleanArg.startsWith('h') ? 'heads' : 'tails';
                } else if (!rawAmount) {
                    rawAmount = arg;
                }
            }

            if (!choice) {
                await message.reply('❌ Invalid choice! Pick either **heads** or **tails**.');
                return true;
            }

            const amount = parseAmount(rawAmount);
            if (!amount || amount <= 0) {
                await message.reply('❌ Invalid bet amount.');
                return true;
            }

            const user = await getOrCreateUser(message.author.id, message.author.username);

            if ((user?.balance || 0) < amount) {
                await message.reply('❌ Insufficient balance for this bet!');
                return true;
            }

            // Deduct initial bet balance
            const currentBal = user.balance - amount;
            await supabase.from('balances').update({ balance: currentBal }).eq('user_id', message.author.id);

            // Fetch configured win odds (default to 45%)
            const { data: setting } = await supabase.from('game_settings').select('win_chance').eq('game_name', 'cf').single();
            const winChance = setting ? setting.win_chance : 45;

            // Determine Outcome
            const isWin = Math.random() * 100 < winChance;
            const landedOn = isWin ? choice : (choice === 'heads' ? 'tails' : 'heads');

            // Send Initial Suspense Message
            const initialMsg = await message.reply('🪙 **Flipping the coin...**');

            // Suspense Edit Sequence (3-4 Edits)
            const frames = ['🪙 **Flipping...** [ 🌕 Heads ]', '🪙 **Flipping...** [ 🌑 Tails ]', '🪙 **Flipping...** [ 🌕 Heads ]'];
            for (const frame of frames) {
                await new Promise(res => setTimeout(res, 700));
                await initialMsg.edit(frame).catch(() => {});
            }

            await new Promise(res => setTimeout(res, 800));

            // Process Post-Game Balances
            let newBalance = currentBal;
            let wagerLeft = Math.max(0, (user.wager_required || 0) - amount);

            if (isWin) {
                const winnings = amount * 2;
                newBalance += winnings;

                await supabase.from('balances').update({
                    balance: newBalance,
                    wager_required: wagerLeft
                }).eq('user_id', message.author.id);
            } else {
                // Calculation on Loss:
                // 1. Rakeback: 0.5% of loss
                const rakebackAdd = amount * 0.005;
                const newRakeback = (user.rakeback || 0) + rakebackAdd;

                await supabase.from('balances').update({
                    balance: newBalance,
                    rakeback: newRakeback,
                    wager_required: wagerLeft
                }).eq('user_id', message.author.id);

                // 2. Referral Lifetime Commission: 2% of loss to Referrer
                if (user.referred_by) {
                    const refCommission = amount * 0.02;
                    const { data: referrer } = await supabase.from('balances').select('unclaimed_ref_rewards').eq('user_id', user.referred_by).single();
                    if (referrer) {
                        await supabase.from('balances').update({
                            unclaimed_ref_rewards: (referrer.unclaimed_ref_rewards || 0) + refCommission
                        }).eq('user_id', user.referred_by);
                    }
                }
            }

            // Final Result Embed
            const resultEmbed = new EmbedBuilder()
                .setColor(isWin ? '#2ECC71' : '#E74C3C')
                .setTitle(`🪙 Coinflip — ${isWin ? 'YOU WON!' : 'YOU LOST!'}`)
                .addFields(
                    { name: 'Choice', value: choice === 'heads' ? 'Heads' : 'Tails', inline: true },
                    { name: 'Landed On', value: landedOn === 'heads' ? 'Heads' : 'Tails', inline: true },
                    { name: 'Result', value: isWin ? `+$${amount.toLocaleString()}` : `-$${amount.toLocaleString()}` },
                    { name: 'New Balance', value: `$${newBalance.toLocaleString()}` }
                );

            await initialMsg.edit({ content: null, embeds: [resultEmbed] });
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in game handler:', err);
        return false;
    }
}

module.exports = { handleGameCommands };
