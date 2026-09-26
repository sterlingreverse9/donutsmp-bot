const supabase = require('../config/supabase');
const { getOrCreateUser, parseAmount } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    try {
        const user = await getOrCreateUser(message.author.id, message.author.username);

        // --- HELP COMMAND ---
        if (['help', 'commands', 'start'].includes(command)) {
            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('📜 Donut Bet - Command List')
                .setDescription('Available commands:')
                .addFields(
                    {
                        name: '💰 Account',
                        value: [
                            `\`${prefix}bal\` - Check balance`,
                            `\`${prefix}ref\` - Referral dashboard & claim`,
                            `\`${prefix}link <MC_IGN>\` - Link MC username`,
                            `\`${prefix}unlink\` - Remove linked IGN`,
                            `\`${prefix}wager\` - Check wager requirement`,
                            `\`${prefix}rakeback\` - Claim rakeback`,
                            `\`${prefix}pay @user <amount>\` - Tip user`
                        ].join('\n')
                    },
                    {
                        name: '📥 Banking',
                        value: [
                            `\`${prefix}depo <amount>\` - Deposit request`,
                            `\`${prefix}withdraw <amount>\` - Withdrawal request`
                        ].join('\n')
                    },
                    {
                        name: '🎲 Games',
                        value: [
                            `\`${prefix}limbo <amount> <multiplier>\` - Limbo game`,
                            `\`${prefix}cf <amount> <heads/tails>\` - Coinflip game`
                        ].join('\n')
                    }
                )
                .setFooter({ text: 'Donut Bet Bot' });

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- BALANCE ---
        if (['bal', 'balance', 'b', 'profile'].includes(command)) {
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

        // --- LINK & UNLINK ---
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

        if (command === 'unlink') {
            if (!user?.mc_username) {
                await message.reply('❌ You do not have any linked Minecraft account.');
                return true;
            }

            await supabase
                .from('balances')
                .update({ mc_username: null })
                .eq('user_id', message.author.id);

            await message.reply('✅ Successfully unlinked your Minecraft account!');
            return true;
        }

        // --- WAGER TRACKER ---
        if (command === 'wager') {
            const remainingWager = user?.wager_required || 0;
            const embed = new EmbedBuilder()
                .setColor(remainingWager > 0 ? '#E74C3C' : '#2ECC71')
                .setTitle('🎯 Wager Requirement Status')
                .setDescription(
                    remainingWager > 0
                        ? `You still need to wager **$${remainingWager.toLocaleString()}** before making a withdrawal.`
                        : '🎉 You have fulfilled all wager requirements! You can freely withdraw.'
                );

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- DEPOSIT FLOW ---
        if (['depo', 'deposit'].includes(command)) {
            if (!user?.mc_username) {
                await message.reply(`❌ Please link your Minecraft account first using \`${prefix}link <MC_IGN>\`.`);
                return true;
            }

            const rawAmount = args[0];
            const amount = parseAmount(rawAmount);

            if (!amount || amount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}depo <amount>\` (e.g. \`${prefix}depo 500k\`)`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setColor('#3498DB')
                .setTitle('📥 Deposit Request Initiated')
                .setDescription(`To complete your deposit of **$${amount.toLocaleString()}**, send the money in-game to:`)
                .addFields(
                    { name: 'In-Game Pay Command', value: `\`\`\`/pay .fbfnch ${amount}\`\`\`` },
                    { name: 'Linked IGN', value: `\`${user.mc_username}\`` }
                )
                .setFooter({ text: 'Click "I Paid" after sending the money in-game.' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`depo_paid_${amount}`)
                    .setLabel('I Paid')
                    .setStyle(ButtonStyle.Success)
            );

            await message.reply({ embeds: [embed], components: [row] });
            return true;
        }

        // --- WITHDRAW FLOW ---
        if (['withdraw', 'with'].includes(command)) {
            if (!user?.mc_username) {
                await message.reply(`❌ Please link your Minecraft account first using \`${prefix}link <MC_IGN>\`.`);
                return true;
            }

            const rawAmount = args[0];
            const amount = parseAmount(rawAmount);

            if (!amount || amount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}withdraw <amount>\` (e.g. \`${prefix}withdraw 500k\`)`);
                return true;
            }

            if ((user.balance || 0) < amount) {
                await message.reply('❌ Insufficient balance for this withdrawal.');
                return true;
            }

            if ((user.wager_required || 0) > 0) {
                await message.reply(`❌ You must fulfill your remaining wager requirement of **$${user.wager_required.toLocaleString()}** before withdrawing.`);
                return true;
            }

            // Deduct balance immediately pending payout
            await supabase
                .from('balances')
                .update({ balance: user.balance - amount })
                .eq('user_id', message.author.id);

            await message.reply('✅ Admin has been notified! You will receive your money shortly.');

            // Send notification to Admin DM
            const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;
            try {
                const adminUser = await message.client.users.fetch(ADMIN_ID);
                
                const adminEmbed = new EmbedBuilder()
                    .setColor('#F39C12')
                    .setTitle('📤 New Withdrawal Request Alert!')
                    .addFields(
                        { name: 'User', value: `${message.author.tag} (\`${message.author.id}\`)` },
                        { name: 'MC IGN', value: `\`${user.mc_username}\`` },
                        { name: 'Amount', value: `$${amount.toLocaleString()}` }
                    )
                    .setTimestamp();

                const adminRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`admin_withdraw_approve_${message.author.id}_${amount}`)
                        .setLabel('I Paid')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`admin_withdraw_decline_${message.author.id}_${amount}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger)
                );

                await adminUser.send({ embeds: [adminEmbed], components: [adminRow] });
            } catch (err) {
                console.error('Failed to send DM to Admin:', err);
            }

            return true;
        }

        // --- REFERRAL DASHBOARD ---
        if (['ref', 'refer', 'referral'].includes(command)) {
            const { data: refList } = await supabase
                .from('balances')
                .select('*')
                .eq('referred_by', message.author.id);

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
                .setFooter({ text: 'Donut Bet Bot' });

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

        return false;
    } catch (err) {
        console.error('❌ Error in handleGeneralCommands:', err);
        await message.reply('❌ Error executing command.');
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
