const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    const user = await getOrCreateUser(message.author.id, message.author.username);

    // Profile & Balance Check
    if (['bal', 'balance', 'b', 'profile'].includes(command)) {
        const embed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle(`💰 ${message.author.username}'s Profile`)
            .addFields(
                { name: 'Balance', value: `$${(user.balance || 0).toLocaleString()}`, inline: true },
                { name: 'Linked IGN', value: user.mc_username ? `\`${user.mc_username}\`` : 'None (`/link`)', inline: true },
                { name: 'Rakeback', value: `$${(user.rakeback || 0).toLocaleString()}`, inline: true },
                { name: 'Wager Left', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
            );
        await message.reply({ embeds: [embed] });
        return true;
    }

    // Help Menu
    if (['help', 'cmds', 'commands'].includes(command)) {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📜 Donut Bet - Command List')
            .setDescription(`Prefixes: \`${prefix}\``)
            .addFields(
                { name: '💰 Account', value: `\`${prefix}bal\` - Check balance\n\`${prefix}ref\` - Referral dashboard & link\n\`${prefix}linkref <user_id>\` - Link a referrer\n\`${prefix}link <MC_IGN>\` - Link Minecraft IGN` },
                { name: '📥 Banking', value: `\`${prefix}depo <Amount>\` - Deposit request\n\`${prefix}withdraw <Amount>\` - Withdrawal request\n\`${prefix}pay <user> <amount>\` - Tip/Transfer` },
                { name: '🎲 Games', value: `\`${prefix}limbo <Amount> <Multiplier>\` - Limbo game\n\`${prefix}cf <Amount> <heads/tails>\` - Coinflip` }
            );
        await message.reply({ embeds: [embed] });
        return true;
    }

    // New Referral Dashboard
    if (['ref', 'refer', 'referral'].includes(command)) {
        const { data: refList } = await supabase
            .from('balances')
            .select('*')
            .eq('referred_by', message.author.id);

        const totalRefs = refList ? refList.length : 0;
        const refNames = refList && refList.length > 0
            ? refList.map((r, idx) => `${idx + 1}. **${r.username \vert{}\vert{} 'User'}** (${r.ref_reward_claimed ? '✅ Qualified' : '⏳ Pending $1M Deposit'})`).join('\n')
            : 'No referred users yet.';

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🤝 Referral Dashboard')
            .setDescription('Invite friends to earn massive rewards!')
            .addFields(
                { 
                    name: '🎁 Reward Details', 
                    value: '• Your friend deposits **$1,000,000** total\n• You receive **$5,000,000** bonus + **2% of their lifetime losses**!' 
                },
                { 
                    name: '🔗 Your Referral Code', 
                    value: `\`${message.author.id}\``, 
                    inline: true 
                },
                { 
                    name: '📲 Share Command for Friends', 
                    value: `\`${prefix}linkref ${message.author.id}\``, 
                    inline: true 
                },
                { 
                    name: `Referred Users (${totalRefs})`, 
                    value: refNames, 
                    inline: false 
                }
            )
            .setFooter({ text: 'Donut SMP Bot' });

        await message.reply({ embeds: [embed] });
        return true;
    }

    // Link Referrer Command
    if (command === 'linkref') {
        const referrerId = args[0];

        if (!referrerId) {
            await message.reply(`❌ **Usage:** \`${prefix}linkref <referrer_user_id>\``);
            return true;
        }

        if (referrerId === message.author.id) {
            await message.reply('❌ You cannot refer yourself!');
            return true;
        }

        if (user.referred_by) {
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
            .update({ referred_by: referrerId })
            .eq('user_id', message.author.id);

        await message.reply(`✅ Successfully linked **${referrer.username || referrer.user_id}** as your referrer!`);
        return true;
    }

    // Link Minecraft IGN
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

    return false; // Return false so index.js knows to try next module if not matched
}

module.exports = { handleGeneralCommands };
