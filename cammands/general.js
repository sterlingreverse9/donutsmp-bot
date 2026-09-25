const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    const user = await getOrCreateUser(message.author.id, message.author.username);

    if (command === 'bal' || command === 'balance') {
        const embed = new EmbedBuilder()
            .setTitle(`💰 Balance for ${message.author.username}`)
            .setColor(0xf1c40f)
            .addFields(
                { name: 'Wallet Balance', value: `$${user.balance.toLocaleString()}`, inline: true },
                { name: 'Claimable Rakeback', value: `$${(user.rakeback || 0).toLocaleString()}`, inline: true },
                { name: 'Wager Required', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL())
            .setFooter({ text: 'Donut SMP Bot' });

        return message.reply({ embeds: [embed] });
    }

    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('📜 Donut SMP Bot Commands')
            .setColor(0x9b59b6)
            .setDescription(`Current Prefix: \`${prefix}\``)
            .addFields(
                { name: '🎮 Games', value: `\`${prefix}cf <heads/tails> <amount>\`\n\`${prefix}limbo <multiplier> <amount>\`` },
                { name: '💳 Banking', value: `\`${prefix}bal\` — Check balance\n\`${prefix}pay <user> <amount>\` — Pay user\n\`${prefix}rakeback\` — Claim rakeback\n\`${prefix}wager\` — Check wager info` },
                { name: '⚙️ Account', value: `\`${prefix}link <ign>\` — Link Minecraft IGN` }
            );

        return message.reply({ embeds: [embed] });
    }

    return false;
}

module.exports = { handleGeneralCommands };
