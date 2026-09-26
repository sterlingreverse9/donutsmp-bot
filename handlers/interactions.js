const { processRefClaim } = require('../commands/general');

module.exports = (client) => {
    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isButton() && interaction.customId === 'claim_ref_rewards') {
                await interaction.deferReply({ ephemeral: true });
                await processRefClaim(interaction.user.id, interaction);
            }
        } catch (err) {
            console.error('❌ Error in interactionCreate handler:', err);
            if (!interaction.replied) {
                await interaction.reply({ content: '❌ An error occurred processing this action.', ephemeral: true });
            }
        }
    });
};
