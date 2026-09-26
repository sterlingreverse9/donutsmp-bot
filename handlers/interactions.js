const supabase = require('../config/supabase');
const { processRefClaim } = require('../commands/general');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = (client) => {
    client.on('interactionCreate', async (interaction) => {
        try {
            // --- SLASH COMMANDS HANDLER ---
            if (interaction.isChatInputCommand()) {
                const { commandName, user } = interaction;
                await interaction.deferReply().catch(() => {});

                const dbUser = await getOrCreateUser(user.id, user.username);

                // /start or /help
                if (['start', 'help'].includes(commandName)) {
                    let bonusMsg = '';
                    
                    // Force credit $1M if user has not claimed starter bonus
                    if (!dbUser || dbUser.claimed_starter_bonus !== true) {
                        const currentBal = dbUser?.balance || 0;
                        await supabase.from('balances').upsert({
                            user_id: user.id,
                            username: user.username,
                            balance: currentBal + 1000000,
                            claimed_starter_bonus: true
                        });

                        bonusMsg = '\n\n🎉 **First-Time Bonus Claimed!** Added **$1,000,000** to your balance!';
                    }

                    const embed = new EmbedBuilder()
                        .setColor('#F1C40F')
                        .setTitle('🍩 Welcome to Donut Bet!')
                        .setDescription(`Use \`/help\` or \`!help\` to view all available commands.${bonusMsg}`)
                        .setFooter({ text: 'Donut Bet Bot' });

                    await interaction.editReply({ embeds: [embed] }).catch(() => {});
                    return;
                }

                // Handle other slash commands (/bal, /ref, /wager, etc.)
                if (['bal', 'balance'].includes(commandName)) {
                    const embed = new EmbedBuilder()
                        .setColor('#2ECC71')
                        .setTitle(`💰 ${user.username}'s Balance`)
                        .addFields(
                            { name: 'Balance', value: `$${(dbUser?.balance || 0).toLocaleString()}`, inline: true },
                            { name: 'Rakeback', value: `$${(dbUser?.rakeback || 0).toLocaleString()}`, inline: true },
                            { name: 'Wager Required', value: `$${(dbUser?.wager_required || 0).toLocaleString()}`, inline: true }
                        );
                    await interaction.editReply({ embeds: [embed] });
                    return;
                }
            }

            // --- SELECT MENU HANDLER (FIXES "Didn't respond in time" ERROR) ---
            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'select_win_game') {
                    // Acknowledge dropdown selection directly with update
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

                if (customId === 'claim_ref_rewards') {
                    await interaction.deferUpdate().catch(() => {});
                    await processRefClaim(user.id, interaction);
                    return;
                }

                if (customId.startsWith('set_win_chance_')) {
                    await interaction.deferUpdate().catch(() => {});
                    const parts = customId.split('_');
                    const game = parts[3];
                    const chance = parseFloat(parts[4]);

                    await supabase.from('game_settings').upsert({ game_name: game, win_chance: chance });
                    await interaction.editReply({ content: `⚙️ **Updated ${game.toUpperCase()} win chance to ${chance}%!**`, components: [] }).catch(() => {});
                    return;
                }

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
            }

            // --- MODAL SUBMIT HANDLER ---
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
