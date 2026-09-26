const supabase = require('../config/supabase');
const { processRefClaim } = require('../commands/general');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');

module.exports = (client) => {
    client.on('interactionCreate', async (interaction) => {
        try {
            const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;

            // --- SLASH COMMANDS HANDLER ---
            if (interaction.isChatInputCommand()) {
                const { commandName, user, options } = interaction;
                await interaction.deferReply().catch(() => {});

                // Slash Command: /win (Admin Only)
                if (['win', 'setwin'].includes(commandName)) {
                    if (user.id !== ADMIN_ID) {
                        await interaction.editReply({ content: '❌ **Access Denied:** Only administrators can adjust game win odds.' });
                        return;
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

                    await interaction.editReply({ embeds: [embed], components: [selectMenu] });
                    return;
                }

                const dbUser = await getOrCreateUser(user.id, user.username);

                // /start or /help
                if (['start', 'help'].includes(commandName)) {
                    let bonusMsg = '';

                    if (!dbUser || dbUser.claimed_starter_bonus !== true) {
                        const currentBal = dbUser?.balance || 0;
                        const newBalance = currentBal + 1000000;

                        await supabase
                            .from('balances')
                            .update({
                                balance: newBalance,
                                claimed_starter_bonus: true,
                                username: user.username
                            })
                            .eq('user_id', user.id);

                        bonusMsg = '\n\n🎉 **Starter Bonus Claimed!** Added **$1,000,000** to your balance!';
                    }

                    const embed = new EmbedBuilder()
                        .setColor('#F1C40F')
                        .setTitle('🍩 Welcome to Donut Bet!')
                        .setDescription(`Use \`/help\` or \`!help\` to view all available commands.${bonusMsg}`)
                        .setFooter({ text: 'Donut Bet Bot' });

                    await interaction.editReply({ embeds: [embed] }).catch(() => {});
                    return;
                }

                // /link <MC_IGN>
                if (commandName === 'link') {
                    const ign = options.getString('ign') || options.getString('username');
                    if (!ign) {
                        await interaction.editReply({ content: '❌ Please specify your Minecraft IGN.' });
                        return;
                    }

                    await supabase.from('balances').update({ mc_username: ign }).eq('user_id', user.id);
                    await interaction.editReply({ content: `✅ **Successfully linked Minecraft IGN:** \`${ign}\`` });
                    return;
                }

                // /unlink
                if (commandName === 'unlink') {
                    if (!dbUser?.mc_username) {
                        await interaction.editReply({ content: '❌ You don\'t have any Minecraft IGN linked.' });
                        return;
                    }

                    const oldIgn = dbUser.mc_username;
                    await supabase.from('balances').update({ mc_username: null }).eq('user_id', user.id);
                    await interaction.editReply({ content: `✅ **Unlinked Minecraft IGN:** \`${oldIgn}\`` });
                    return;
                }

                // /wager
                if (commandName === 'wager') {
                    const wagerReq = dbUser?.wager_required || 0;
                    const embed = new EmbedBuilder()
                        .setColor(wagerReq > 0 ? '#E67E22' : '#2ECC71')
                        .setTitle('🎰 Wager Requirement Status')
                        .setDescription(
                            wagerReq > 0
                                ? `You need to wager **$${wagerReq.toLocaleString()}** more before requesting a withdrawal.`
                                : '🎉 **No wager requirement!** You are free to withdraw your balance.'
                        );

                    await interaction.editReply({ embeds: [embed] });
                    return;
                }

                // /bal
                if (commandName === 'bal' || commandName === 'balance') {
                    const { data: freshUser } = await supabase.from('balances').select('*').eq('user_id', user.id).single();
                    const activeUser = freshUser || dbUser;

                    const embed = new EmbedBuilder()
                        .setColor('#2ECC71')
                        .setTitle(`💰 ${user.username}'s Balance`)
                        .addFields(
                            { name: 'Balance', value: `$${(activeUser?.balance || 0).toLocaleString()}`, inline: true },
                            { name: 'Rakeback', value: `$${(activeUser?.rakeback || 0).toLocaleString()}`, inline: true },
                            { name: 'Wager Required', value: `$${(activeUser?.wager_required || 0).toLocaleString()}`, inline: true }
                        );

                    await interaction.editReply({ embeds: [embed] });
                    return;
                }
            }

            // --- SELECT MENU HANDLER (ADMIN-PROTECTED ODDS CONFIGURATOR) ---
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'select_win_game') {
                    if (interaction.user.id !== ADMIN_ID) {
                        await interaction.reply({ content: '❌ Access Denied.', ephemeral: true });
                        return;
                    }

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
                    }).catch(() => {});
                    return;
                }
            }

            // --- BUTTON HANDLERS ---
            if (interaction.isButton()) {
                const { customId, user } = interaction;

                // Modal Trigger for Odds Configuration (Admin Only)
                if (customId.startsWith('win_custom_btn_')) {
                    if (user.id !== ADMIN_ID) {
                        await interaction.reply({ content: '❌ Access Denied.', ephemeral: true });
                        return;
                    }

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

                // Defer update for background button events
                await interaction.deferUpdate().catch(() => {});

                // Player Clicks "I Paid" Deposit Button
                if (customId.startsWith('depo_paid_')) {
                    const amount = parseFloat(customId.split('_')[2]);
                    const { data: userData } = await supabase.from('balances').select('*').eq('user_id', user.id).single();

                    const adminUser = await client.users.fetch(ADMIN_ID).catch(() => null);

                    if (adminUser) {
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

                        await adminUser.send({ embeds: [adminEmbed], components: [adminRow] }).catch(console.error);
                    }

                    await interaction.followUp({ content: '✅ **Admin notified!** Your deposit request is under review.', ephemeral: true }).catch(() => {});
                    return;
                }

                // Admin Approves Deposit
                if (customId.startsWith('admin_depo_approve_')) {
                    if (user.id !== ADMIN_ID) return;

                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    const { data: targetUser } = await supabase.from('balances').select('*').eq('user_id', targetUserId).single();
                    const newDepositCount = (targetUser?.deposit_count || 0) + 1;

                    if (targetUser?.referred_by && newDepositCount <= 2) {
                        const referrerReward = amount * 3;
                        const { data: referrer } = await supabase.from('balances').select('*').eq('user_id', targetUser.referred_by).single();
                        if (referrer) {
                            await supabase
                                .from('balances')
                                .update({ unclaimed_ref_rewards: (referrer.unclaimed_ref_rewards || 0) + referrerReward })
                                .eq('user_id', targetUser.referred_by);
                        }
                    }

                    await supabase
                        .from('balances')
                        .update({
                            balance: (targetUser?.balance || 0) + amount,
                            deposit_count: newDepositCount,
                            wager_required: (targetUser?.wager_required || 0) + amount
                        })
                        .eq('user_id', targetUserId);

                    await interaction.editReply({ content: `✅ **Accepted Deposit for <@${targetUserId}> ($${amount.toLocaleString()})!**`, embeds: [], components: [] }).catch(() => {});

                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`🎉 **Deposit Approved!** Your deposit of **$${amount.toLocaleString()}** has been accepted!`);
                    } catch (e) {}
                    return;
                }

                // Admin Declines Deposit
                if (customId.startsWith('admin_depo_decline_')) {
                    if (user.id !== ADMIN_ID) return;

                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    await interaction.editReply({ content: `❌ **Declined Deposit for <@${targetUserId}> ($${amount.toLocaleString()}).**`, embeds: [], components: [] }).catch(() => {});

                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`❌ Your deposit request of **$${amount.toLocaleString()}** was declined by admin.`);
                    } catch (e) {}
                    return;
                }

                // Admin Approves Withdrawal
                if (customId.startsWith('admin_withdraw_approve_')) {
                    if (user.id !== ADMIN_ID) return;

                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    await interaction.editReply({ content: `✅ **Paid Withdrawal for <@${targetUserId}> ($${amount.toLocaleString()})!**`, embeds: [], components: [] }).catch(() => {});

                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`🎉 Your withdrawal of **$${amount.toLocaleString()}** has been paid in-game!`);
                    } catch (e) {}
                    return;
                }

                // Admin Declines Withdrawal
                if (customId.startsWith('admin_withdraw_decline_')) {
                    if (user.id !== ADMIN_ID) return;

                    const [, , , targetUserId, rawAmount] = customId.split('_');
                    const amount = parseFloat(rawAmount);

                    const { data: targetUser } = await supabase.from('balances').select('*').eq('user_id', targetUserId).single();
                    await supabase.from('balances').update({ balance: (targetUser?.balance || 0) + amount }).eq('user_id', targetUserId);

                    await interaction.editReply({ content: `❌ **Declined Withdrawal for <@${targetUserId}> ($${amount.toLocaleString()}). Refunded.**`, embeds: [], components: [] }).catch(() => {});

                    try {
                        const player = await client.users.fetch(targetUserId);
                        await player.send(`❌ Your withdrawal request of **$${amount.toLocaleString()}** was declined. Balance refunded.`);
                    } catch (e) {}
                    return;
                }

                // Admin Preset Win Chance Click
                if (customId.startsWith('set_win_chance_')) {
                    if (user.id !== ADMIN_ID) return;

                    const parts = customId.split('_');
                    const game = parts[3];
                    const chance = parseFloat(parts[4]);

                    await supabase.from('game_settings').upsert({ game_name: game, win_chance: chance });
                    await interaction.editReply({ content: `⚙️ **Updated ${game.toUpperCase()} win chance to ${chance}%!**`, components: [] }).catch(() => {});
                    return;
                }
            }

            // --- MODAL SUBMIT HANDLER ---
            if (interaction.isModalSubmit()) {
                if (interaction.customId.startsWith('win_custom_modal_')) {
                    if (interaction.user.id !== ADMIN_ID) return;

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
