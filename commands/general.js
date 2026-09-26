const supabase = require('../config/supabase');
const { getOrCreateUser, parseAmount } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    try {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;

        // --- ADMIN WIN ODDS CONFIGURATOR (!win) ---
        if (['win', 'setwin', 'odds'].includes(command)) {
            if (message.author.id !== ADMIN_ID) {
                await message.reply('❌ **Access Denied:** Only administrators can adjust game win odds.');
                return true;
            }

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('⚙️ Admin Game Odds Configurator')
                .setDescription('Select a game below to modify its win probability percentage:');

            const selectMenu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_win_game')
                    .setPlaceholder('Select a game to set win chances')
                    .addOptions([
                        { label: 'Coinflip (CF)', value: 'cf', description: 'Configure Coinflip win probability' },
                        { label: 'Limbo', value: 'limbo', description: 'Configure Limbo win probability' }
                    ])
            );

            await message.reply({ embeds: [embed], components: [selectMenu] });
            return true;
        }

        // --- START / HELP COMMAND ---
        if (['start', 'help', 'commands'].includes(command)) {
            let bonusText = '';

            if (!user || user.claimed_starter_bonus !== true) {
                const currentBalance = user?.balance || 0;
                const newBalance = currentBalance + 1000000;

                const { error } = await supabase
                    .from('balances')
                    .update({
                        balance: newBalance,
                        claimed_starter_bonus: true,
                        username: message.author.username
                    })
                    .eq('user_id', message.author.id);

                if (!error) {
                    bonusText = '\n\n🎉 **Starter Bonus Claimed!** Added **$1,000,000** to your balance!';
                }
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

        // --- BALANCE COMMAND ---
        if (['bal', 'balance'].includes(command)) {
            const { data: freshUser } = await supabase.from('balances').select('*').eq('user_id', message.author.id).single();
            const activeUser = freshUser || user;

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle(`💰 ${message.author.username}'s Balance`)
                .addFields(
                    { name: 'Balance', value: `$${(activeUser?.balance || 0).toLocaleString()}`, inline: true },
                    { name: 'Rakeback', value: `$${(activeUser?.rakeback || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Required', value: `$${(activeUser?.wager_required || 0).toLocaleString()}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- LINK MC IGN COMMAND ---
        if (['link', 'linkmc', 'setign'].includes(command)) {
            const mcIgn = args[0];

            if (!mcIgn) {
                await message.reply(`❌ **Usage:** \`${prefix}link <Minecraft_IGN>\``);
                return true;
            }

            await supabase
                .from('balances')
                .update({ mc_username: mcIgn })
                .eq('user_id', message.author.id);

            await message.reply(`✅ **Successfully linked Minecraft IGN:** \`${mcIgn}\``);
            return true;
        }

        // --- UNLINK MC IGN COMMAND ---
        if (['unlink', 'unlinkmc'].includes(command)) {
            if (!user?.mc_username) {
                await message.reply('❌ You don\'t have any Minecraft IGN linked.');
                return true;
            }

            const oldIgn = user.mc_username;
            await supabase
                .from('balances')
                .update({ mc_username: null })
                .eq('user_id', message.author.id);

            await message.reply(`✅ **Unlinked Minecraft IGN:** \`${oldIgn}\``);
            return true;
        }

        // --- WAGER STATUS COMMAND ---
        if (['wager', 'wagerstatus', 'reqwager'].includes(command)) {
            const wagerReq = user?.wager_required || 0;

            const embed = new EmbedBuilder()
                .setColor(wagerReq > 0 ? '#E67E22' : '#2ECC71')
                .setTitle('🎰 Wager Requirement Status')
                .setDescription(
                    wagerReq > 0
                        ? `You need to wager **$${wagerReq.toLocaleString()}** more before requesting a withdrawal.`
                        : '🎉 **No wager requirement!** You are free to withdraw your balance.'
                );

            await message.reply({ embeds: [embed] });
            return true;
        }

        // --- REFERRAL DASHBOARD COMMAND ---
        if (['ref', 'referral', 'referrals'].includes(command)) {
            const unclaimed = user?.unclaimed_ref_rewards || 0;

            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle('👥 Referral Dashboard')
                .setDescription(`Share your User ID with friends to earn rewards!\nYour ID: \`${message.author.id}\``)
                .addFields(
                    { name: 'Your Referrer', value: user?.referred_by ? `<@${user.referred_by}>` : 'None linked (`!linkref <id>`)' },
                    { name: 'Unclaimed Rewards', value: `$${unclaimed.toLocaleString()}` }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ref_rewards')
                    .setLabel('Claim Rewards')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(unclaimed <= 0)
            );

            await message.reply({ embeds: [embed], components: [row] });
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

        // --- DEPOSIT REQUEST COMMAND (WITH "I PAID" BUTTON) ---
        if (['depo', 'deposit'].includes(command)) {
            const amount = parseAmount(args[0]);
            if (!amount || amount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}depo <amount>\` (e.g. \`${prefix}depo 100k\`)`);
                return true;
            }

            const embed = new EmbedBuilder()
                .setColor('#3498DB')
                .setTitle('📥 Deposit Request Initiated')
                .setDescription(`To complete your deposit of **$${amount.toLocaleString()}**, send the money in-game to:`)
                .addFields(
                    { name: 'In-Game Pay Command', value: `\`/pay .fbfnch ${amount}\`` },
                    { name: 'Linked IGN', value: `\`${user?.mc_username || 'Not Linked'}\`` }
                )
                .setFooter({ text: 'Click "I Paid" after sending the money in-game.' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`depo_paid_${message.author.id}_${amount}`)
                    .setLabel('I Paid')
                    .setStyle(ButtonStyle.Success)
            );

            await message.reply({ embeds: [embed], components: [row] });
            return true;
        }

        // --- WITHDRAW REQUEST COMMAND ---
        if (['withdraw', 'with'].includes(command)) {
            const amount = parseAmount(args[0]);
            if (!amount || amount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}withdraw <amount>\``);
                return true;
            }

            if ((user?.balance || 0) < amount) {
                await message.reply('❌ Insufficient balance to withdraw this amount.');
                return true;
            }

            if ((user?.wager_required || 0) > 0) {
                await message.reply(`❌ You must fulfill your wager requirement of **$${user.wager_required.toLocaleString()}** before withdrawing.`);
                return true;
            }

            await supabase.from('balances').update({
                balance: user.balance - amount
            }).eq('user_id', message.author.id);

            const adminUser = await message.client.users.fetch(ADMIN_ID).catch(() => null);

            if (adminUser) {
                const adminEmbed = new EmbedBuilder()
                    .setColor('#E74C3C')
                    .setTitle('🔔 New Withdrawal Request!')
                    .addFields(
                        { name: 'User', value: `${message.author.tag} (\`${message.author.id}\`)` },
                        { name: 'MC IGN', value: `\`${user?.mc_username || 'Not Linked'}\`` },
                        { name: 'Amount', value: `$${amount.toLocaleString()}` }
                    );

                const adminRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`admin_withdraw_approve_${message.author.id}_${amount}`)
                        .setLabel('Paid In-Game')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`admin_withdraw_decline_${message.author.id}_${amount}`)
                        .setLabel('Decline & Refund')
                        .setStyle(ButtonStyle.Danger)
                );

                await adminUser.send({ embeds: [adminEmbed], components: [adminRow] }).catch(() => {});
            }

            await message.reply(`✅ **Withdrawal request of $${amount.toLocaleString()} submitted!** Admin has been notified.`);
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
