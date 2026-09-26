const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    try {
        if (['bal', 'balance', 'b', 'profile'].includes(command)) {
            const user = await getOrCreateUser(message.author.id, message.author.username);

            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle(`💰 ${message.author.username}'s Profile`)
                .addFields(
                    { name: 'Balance', value: `$${(user?.balance || 0).toLocaleString()}`, inline: true },
                    { name: 'Linked IGN', value: user?.mc_username ? `\`${user.mc_username}\`` : 'None (`!link <IGN>`)', inline: true },
                    { name: 'Rakeback', value: `$${(user?.rakeback || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Left', value: `$${(user?.wager_required || 0).toLocaleString()}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }

        if (['ref', 'refer', 'referral'].includes(command)) {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            
            const { data: refList, error } = await supabase
                .from('balances')
                .select('*')
                .eq('referred_by', message.author.id);

            if (error) console.error('Supabase query error:', error);

            const totalRefs = refList ? refList.length : 0;
            const refNames = refList && refList.length > 0
                ? refList.map((r, idx) => `${idx + 1}. **${r.username || r.user_id}**`).join('\n')
                : 'No referred users yet.';

            const unclaimed = user?.unclaimed_ref_rewards || 0;

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('🤝 Referral Dashboard')
                .setDescription('Invite friends to earn massive rewards!')
                .addFields(
                    { name: '🎁 Reward Details', value: '• **3x bonus** on your referral\'s **first 2 deposits**!\n• **2% lifetime commission** on all their losses!' },
                    { name: '🔗 Your Referral ID', value: `\`${message.author.id}\``, inline: true },
                    { name: '📲 Link Command', value: `\`${prefix}linkref ${message.author.id}\``, inline: true },
                    { name: '💵 Unclaimed Rewards', value: `\`$${unclaimed.toLocaleString()}\``, inline: false },
                    { name: `Referred Users (${totalRefs})`, value: refNames, inline: false }
                )
                .setFooter({ text: 'Donut SMP Bot' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ref_rewards')
                    .setLabel(`Claim $${unclaimed.toLocaleString()}`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(unclaimed <= 0)
            );

            await message.reply({ embeds: [embed], components: [row] });
            return true;
        }

        if (command === 'claimref') {
            await processRefClaim(message.author.id, message);
            return true;
        }

        if (command === 'linkref') {
            const user = await getOrCreateUser(message.author.id, message.author.username);
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

            const { data: referrer } = await supabase
                .from('balances')
                .select('*')
                .eq('user_id', referrerId)
                .single();

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

        if (command === 'link') {
            const mcUsername = args[0];

            if (!mcUsername) {
                await message.reply(`❌ **Usage:** \`${prefix}link <MC_IGN>\``);
                return true;
            }

            await supabase
                .from('balances')
                .update({ mc_username: mcUsername })
                .eq('user_id', message.author.id);

            await message.reply(`✅ Successfully linked Minecraft IGN **\`${mcUsername}\`**!`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in handleGeneralCommands:', err);
        await message.reply('❌ Error executing general command.');
        return true;
    }
}

async function processRefClaim(userId, target) {
    const { data: user } = await supabase.from('balances').select('*').eq('user_id', userId).single();
    const unclaimed = user?.unclaimed_ref_rewards || 0;

    if (unclaimed <= 0) {
        const msg = '❌ You have no pending referral rewards to claim.';
        return target.reply ? target.reply(msg) : target.followUp({ content: msg, ephemeral: true });
    }

    await supabase
        .from('balances')
        .update({
            balance: (user.balance || 0) + unclaimed,
            unclaimed_ref_rewards: 0
        })
        .eq('user_id', userId);

    const successMsg = `🎉 **Claimed!** Added **$${unclaimed.toLocaleString()}** referral rewards to your balance!`;
    return target.reply ? target.reply(successMsg) : target.followUp({ content: successMsg, ephemeral: true });
}

module.exports = { handleGeneralCommands, processRefClaim };
