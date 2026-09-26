const supabase = require('../config/supabase');
const { processRefClaim } = require('../commands/general');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = (client) => {
    client.on('interactionCreate', async (interaction) => {
        try {
            // --- BUTTON HANDLERS ---
            if (interaction.isButton()) {
                const { customId, user } = interaction;

                // 1. Claim Referral Rewards Button
                if (customId === 'claim_ref_rewards') {
                    await interaction.deferReply({ ephemeral: true });
                    await processRefClaim(user.id, interaction);
                    return;
                }

                // 2. Player Clicked "I Paid" for Deposit
                if (customId.startsWith('depo_paid_')) {
                    const amount = parseFloat(customId.split('_')[2]);
                    await interaction.deferReply({ ephemeral: true });

                    const { data: userData } = await supabase.from('balances').select('*').eq('user_id', user.id).single();

                    const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;
                    const adminUser = await client.users.fetch(ADMIN_ID);

                    const adminEmbed = new EmbedBuilder()
                        .setColor('#F1C40F')
                        .setTitle('🔔 New Deposit Alert!')
                        .addFields(
                            { name: 'User', value: `${user.tag} (\`${user.id}\`)` },
                            { name: 'MC IGN', value: `\`${userData?.mc_username || 'Not Linked'}\`` },
                            { name: 'Amount', value: `$${amount.toLocaleString()}` }
                        )
                        .setTimestamp();

                    const adminRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`admin_depo_approve_${user.id}_${amount}`)
                            .setLabel('Approve')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`admin_depo_decline_${user.id}_${amount}`)
                            .setLabel('Decline')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await adminUser.send({ embeds: [adminEmbed], components: [adminRow] });
                    await interaction.followUp({ content: '✅ Admin has been notified of your payment! Your deposit will be processed shortly.', ephemeral: true });
                    return;
                }

                // 3. Admin Approve Deposit
                if (customId.startsWith('admin_depo_approve_')) {
                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    const { data: targetUser } = await supabase.from('balances').select('*').eq('user_id', targetUserId).single();
                    const newDepositCount = (targetUser?.deposit_count || 0) + 1;
                    let referrerReward = 0;

                    // Apply 3x referral deposit bonus on first 2 deposits
                    if (targetUser?.referred_by && newDepositCount <= 2) {
                        referrerReward = amount * 3;
                        const { data: referrer } = await supabase.from('balances').select('*').eq('user_id', targetUser.referred_by).single();
                        if (referrer) {
                            await supabase
                                .from('balances')
                                .update({ unclaimed_ref_rewards: (referrer.unclaimed_ref_rewards || 0) + referrerReward })
                                .eq('user_id', targetUser.referred_by);
                        }
                    }

                    // Add deposit amount to balance & add 1x wager requirement
                    await supabase
                        .from('balances')
                        .update({
                            balance: (targetUser?.balance || 0) + amount,
                            deposit_count: newDepositCount,
                            wager_required: (targetUser?.wager_required || 0) + amount
                        })
                        .eq('user_id', targetUserId);

                    await interaction.update({ content: `✅ **Accepted Deposit for <@${targetUserId}> ($${amount.toLocaleString()})!**`, embeds: [], components: [] });

                    // DM user confirmation
                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`🎉 **Deposit Approved!** Your deposit of **$${amount.toLocaleString()}** has been accepted!`);
                    } catch (e) { console.error('DM Error:', e); }
                    return;
                }

                // 4. Admin Decline Deposit
                if (customId.startsWith('admin_depo_decline_')) {
                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    await interaction.update({ content: `❌ **Declined Deposit for <@${targetUserId}> ($${amount.toLocaleString()}).**`, embeds: [], components: [] });

                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`❌ Your deposit request of **$${amount.toLocaleString()}** was declined by admin.`);
                    } catch (e) { console.error('DM Error:', e); }
                    return;
                }

                // 5. Admin Approve Withdrawal ("I Paid")
                if (customId.startsWith('admin_withdraw_approve_')) {
                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    await interaction.update({ content: `✅ **Paid Withdrawal for <@${targetUserId}> ($${amount.toLocaleString()})!**`, embeds: [], components: [] });

                    // Notify user in DM to leave a vouch
                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`🎉 Your withdrawal of **$${amount.toLocaleString()}** has been paid in-game! Please leave a vouch in the channel!`);
                    } catch (e) { console.error('DM Error:', e); }

                    // Public channel announcement
                    const announcementChannelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
                    if (announcementChannelId) {
                        const channel = await client.channels.fetch(announcementChannelId);
                        if (channel) {
                            await channel.send(`📢 **Withdrawal Notice:** <@${targetUserId}> successfully withdrew **$${amount.toLocaleString()}** and was paid in-game!`);
                        }
                    }
                    return;
                }

                // 6. Admin Decline Withdrawal
                if (customId.startsWith('admin_withdraw_decline_')) {
                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    // Refund user balance
                    const { data: targetUser } = await supabase.from('balances').select('*').eq('user_id', targetUserId).single();
                    await supabase.from('balances').update({ balance: (targetUser?.balance || 0) + amount }).eq('user_id', targetUserId);

                    await interaction.update({ content: `❌ **Declined Withdrawal for <@${targetUserId}> ($${amount.toLocaleString()}). Balance refunded.**`, embeds: [], components: [] });

                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`❌ Your withdrawal request of **$${amount.toLocaleString()}** was declined. Your funds have been refunded to your bot balance.`);
                    } catch (e) { console.error('DM Error:', e); }
                    return;
                }

                // 7. Custom Win Percentage Modal Trigger Button
                if (customId.startsWith('win_custom_btn_')) {
                    const game = customId.replace('win_custom_btn_', '');
                    const modal = new ModalBuilder()
                        .setCustomId(`win_custom_modal_${game}`)
                        .setTitle('Custom Win Percentage');

                    const input = new TextInputBuilder()
                        .setCustomId('win_percent_input')
                        .setLabel('Enter Win Percentage (0 - 100)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('e.g., 65')
                        .setRequired(true);

                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    await interaction.showModal(modal);
                    return;
                }

                // 8. Preset Win Buttons Clicked
                if (customId.startsWith('set_win_chance_')) {
                    const parts = customId.split('_');
                    const game = parts[3];
                    const chance = parseFloat(parts[4]);

                    await supabase.from('game_settings').upsert({ game_name: game, win_chance: chance });
                    await interaction.update({ content: `⚙️ **Updated ${game.toUpperCase()} win chance to ${chance}%**`, components: [] });
                    return;
                }
            }

            // --- SELECT MENU HANDLERS ---
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'select_win_game') {
                    const selectedGame = interaction.values[0];

                    const presetRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`set_win_chance_${selectedGame}_0`).setLabel('0%').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`set_win_chance_${selectedGame}_5`).setLabel('5%').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`set_win_chance_${selectedGame}_10`).setLabel('10%').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`set_win_chance_${selectedGame}_15`).setLabel('15%').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`set_win_chance_${selectedGame}_20`).setLabel('20%').setStyle(ButtonStyle.Secondary)
                    );

                    const presetRow2 = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`set_win_chance_${selectedGame}_45`).setLabel('Default (45%)').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`win_custom_btn_${selectedGame}`).setLabel('Custom %').setStyle(ButtonStyle.Primary)
                    );

                    await interaction.update({
                        content: `🎰 Select desired win probability for **${selectedGame.toUpperCase()}**:`,
                        components: [presetRow, presetRow2]
                    });
                }
            }

            // --- MODAL SUBMIT HANDLERS ---
            if (interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('win_custom_modal_')) {
                    const game = interaction.customId.replace('win_custom_modal_', '');
                    const chance = parseFloat(interaction.fields.getTextInputValue('win_percent_input'));

                    if (isNaN(chance) || chance < 0 || chance > 100) {
                        await interaction.reply({ content: '❌ Invalid percentage. Enter a number between 0 and 100.', ephemeral: true });
                        return;
                    }

                    await supabase.from('game_settings').upsert({ game_name: game, win_chance: chance });
                    await interaction.reply({ content: `⚙️ **Custom win chance set to ${chance}% for ${game.toUpperCase()}!**`, ephemeral: true });
                }
            }
        } catch (err) {
            console.error('❌ Error in interaction handler:', err);
        }
    });
};
