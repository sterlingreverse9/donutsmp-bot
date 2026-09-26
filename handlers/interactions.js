// Inside interaction event listener for "admin_depo_approve_"
if (customId.startsWith('admin_depo_approve_')) {
    const [, , , targetUserId, rawAmount] = customId.split('_');
    const amount = parseFloat(rawAmount);

    const { data: targetUser } = await supabase.from('balances').select('*').eq('user_id', targetUserId).single();
    const newDepositCount = (targetUser?.deposit_count || 0) + 1;

    // Award 3x Deposit Bonus to Referrer on First 2 Deposits
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

    // Update target player balance
    await supabase
        .from('balances')
        .update({
            balance: (targetUser?.balance || 0) + amount,
            deposit_count: newDepositCount,
            wager_required: (targetUser?.wager_required || 0) + amount
        })
        .eq('user_id', targetUserId);

    await interaction.editReply({ content: `✅ **Accepted Deposit for <@${targetUserId}> ($${amount.toLocaleString()})!**`, embeds: [], components: [] }).catch(() => {});
    return;
}
