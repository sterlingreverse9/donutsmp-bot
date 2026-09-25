async function checkAndPayReferralReward(userId, depositAmount) {
    const user = await getOrCreateUser(userId);
    if (!user.referred_by || user.ref_reward_claimed) return;

    // Track cumulative deposits
    const totalDeposits = (user.total_deposited || 0) + depositAmount;
    await supabase.from('balances').update({ total_deposited: totalDeposits }).eq('user_id', userId);

    // Threshold check: 1 Million Deposit
    if (totalDeposits >= 1000000) {
        const { data: referrer } = await supabase
            .from('balances')
            .select('*')
            .eq('user_id', user.referred_by)
            .single();

        if (referrer) {
            // Calculate 2% of lifetime losses: (Total Bet - Total Won) * 0.02
            const lifetimeLoss = Math.max(0, (user.total_wagered || 0) - (user.total_won || 0));
            const lossBonus = Math.floor(lifetimeLoss * 0.02);
            const totalBonus = 5000000 + lossBonus; // $5M + 2% loss share

            // Pay Referrer
            await supabase.from('balances').update({
                balance: (referrer.balance || 0) + totalBonus
            }).eq('user_id', referrer.user_id);

            // Mark bonus as claimed so it only triggers once
            await supabase.from('balances').update({ ref_reward_claimed: true }).eq('user_id', userId);
        }
    }
}
