const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');

async function handleInteractions(interaction, client) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

    const user = await getOrCreateUser(interaction.user.id, interaction.user.username);

    if (interaction.customId === 'claim_starter') {
        if (user.claimed_starter) {
            return interaction.reply({ content: '❌ You have already claimed your starter bonus!', ephemeral: true });
        }

        const bonus = 1000;
        await supabase.from('balances').update({
            balance: user.balance + bonus,
            claimed_starter: true
        }).eq('user_id', user.user_id);

        return interaction.reply({ content: `🎉 You received **$${bonus.toLocaleString()}** starter bonus!`, ephemeral: true });
    }
}

module.exports = { handleInteractions };
