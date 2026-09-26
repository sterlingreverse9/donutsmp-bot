const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    try {
        const user = await getOrCreateUser(message.author.id, message.author.username);

        // --- START / HELP COMMAND ---
        if (['start', 'help', 'commands'].includes(command)) {
            let bonusText = '';

            // Award $1M bonus on first start trigger
            if (!user?.claimed_starter_bonus) {
                await supabase.from('balances').update({
                    balance: (user?.balance || 0) + 1000000,
                    claimed_starter_bonus: true
                }).eq('user_id', message.author.id);

                bonusText = '\n\n🎉 **First-Time Bonus Claimed!** Added **$1,000,000** starter bonus to your account!';
            }

            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('📜 Donut Bet - Command List')
                .setDescription(`Welcome to Donut Bet!${bonusText}`)
                .addFields(
                    {
                        name: '💰 Account Commands',
                        value: [
                            `\`${prefix}bal\` - Check balance`,
                            `\`${prefix}ref\` - Referral dashboard`,
                            `\`${prefix}linkref <referrer_id>\` - Link referrer`,
                            `\`${prefix}link <MC_IGN>\` - Link MC IGN`,
                            `\`${prefix}unlink\` - Unlink MC IGN`,
                            `\`${prefix}wager\` - Check wager status`,
                            `\`${prefix}rakeback\` - Claim loss rakeback`,
                            `\`${prefix}pay @user <amount>\` - Transfer balance`
                        ].join('\n')
                    },
                    {
                        name: '📥 Banking',
                        value: [
                            `\`${prefix}depo <amount>\` - Request deposit`,
                            `\`${prefix}withdraw <amount>\` - Request withdrawal`
                        ].join('\n')
                    },
                    {
                        name: '🎲 Available Games',
                        value: [
                            `\`${prefix}cf <heads/tails> <amount>\` - Coinflip`,
                            `\`${prefix}limbo <multiplier> <amount>\` - Limbo`
                        ].join('\n')
                    }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- RAKEBACK CLAIM COMMAND ---
        if (command === 'rakeback') {
            const currentRakeback = user?.rakeback || 0;

            if (currentRakeback <= 0) {
                await message.reply('❌ You have no rakeback to claim.');
                return true;
            }

            await supabase
                .from('balances')
                .update({
                    balance: (user.balance || 0) + currentRakeback,
                    rakeback: 0
                })
                .eq('user_id', message.author.id);

            await message.reply(`🎉 **Claimed $${currentRakeback.toLocaleString()} in Rakeback!** Funds added to your balance.`);
            return true;
        }

        // --- LINKREF COMMAND ---
        if (['linkref', 'reflink'].includes(command)) {
            const referrerId = args[0];

            if (!referrerId) {
                await message.reply(`❌ **Usage:** \`${prefix}linkref <referrer_user_id>\``);
                return true;
            }
            if (referrerId === message.author.id) {
                await message.reply('❌ You cannot refer yourself!');
                return true;
            }
            if (user?.referred_by) {
                await message.reply('❌ You have already linked a referrer.');
                return true;
            }

            const { data: referrer } = await supabase.from('balances').select('*').eq('user_id', referrerId).single();

            if (!referrer) {
                await message.reply('❌ Invalid referrer User ID.');
                return true;
            }

            await supabase
                .from('balances')
                .update({ referred_by: referrerId, deposit_count: 0 })
                .eq('user_id', message.author.id);

            await message.reply(`✅ Successfully linked **${referrer.username || referrer.user_id}** as your referrer!`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in general commands:', err);
        return false;
    }
}

async function processRefClaim(userId, interaction) {
    const { data: user } = await supabase.from('balances').select('*').eq('user_id', userId).single();
    const rewards = user?.unclaimed_ref_rewards || 0;

    if (rewards <= 0) {
        await interaction.followUp({ content: '❌ You have no unclaimed referral rewards.', ephemeral: true }).catch(() => {});
        return;
    }

    await supabase.from('balances').update({
        balance: (user.balance || 0) + rewards,
        unclaimed_ref_rewards: 0
    }).eq('user_id', userId);

    await interaction.followUp({ content: `🎉 **Claimed $${rewards.toLocaleString()} in referral rewards!**`, ephemeral: true }).catch(() => {});
}

module.exports = { handleGeneralCommands, processRefClaim };
