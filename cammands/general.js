const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    const user = await getOrCreateUser(message.author.id, message.author.username);

    if (['ref', 'refer', 'referral'].includes(command)) {
        // Build a direct link or simple referral share block
        const refLink = `https://discord.com/channels/${message.guildId}/${message.channelId}?ref=${message.author.id}`;

        const embed = new EmbedBuilder()
            .setTitle('🤝 Your Referral Link & Stats')
            .setColor(0x2ecc71)
            .setDescription(`Share your referral code/link with friends to earn rewards!`)
            .addFields(
                { name: '📋 Your Referral Code', value: `\`${message.author.id}\``, inline: true },
                { name: '🎁 Reward Terms', value: '• Your friend deposits **$1M**\n• You get **$5M Instant Bonus** + **2% of their lifetime losses**!', inline: false },
                { name: '🔗 Quick Share', value: `Send your friend this code to run: \`${prefix}linkref ${message.author.id}\`` }
            )
            .setFooter({ text: 'Donut SMP Bot' });

        return message.reply({ embeds: [embed] });
    }

    if (command === 'linkref') {
        const referrerId = args[0];
        if (!referrerId) {
            return message.reply(`❌ **Usage:** \`${prefix}linkref <referrer_user_id>\``);
        }

        if (referrerId === message.author.id) {
            return message.reply("❌ You cannot refer yourself!");
        }

        if (user.referred_by) {
            return message.reply("❌ You have already linked a referrer!");
        }

        const { data: referrer } = await supabase.from('balances').select('*').eq('user_id', referrerId).single();
        if (!referrer) {
            return message.reply("❌ Invalid referrer ID.");
        }

        await supabase.from('balances').update({ referred_by: referrerId }).eq('user_id', message.author.id);
        return message.reply(`✅ Successfully linked **${referrer.username || referrer.user_id}** as your referrer!`);
    }

    return false;
}

module.exports = { handleGeneralCommands };
