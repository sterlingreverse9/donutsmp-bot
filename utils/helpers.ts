const supabase = require('../config/supabase');

// Formats amounts like "100k", "1.5m", "2b" into raw numbers
function parseAmount(input) {
    if (!input) return null;
    const match = String(input).trim().toLowerCase().match(/^([\d.]+)([kmb]?)$/);
    if (!match) return null;

    let num = parseFloat(match[1]);
    const multiplier = match[2];

    if (isNaN(num)) return null;

    if (multiplier === 'k') num *= 1000;
    if (multiplier === 'm') num *= 1000000;
    if (multiplier === 'b') num *= 1000000000;

    return Math.floor(num);
}

// Retrieves or initializes a database record for a Discord user
async function getOrCreateUser(userId, username) {
    const { data: user, error } = await supabase
        .from('balances')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (user) return user;

    const newUser = {
        user_id: userId,
        username: username,
        balance: 0,
        rakeback: 0,
        wager_required: 0,
        loss_streak: 0,
        referred_by: null,
        ref_reward_claimed: false
    };

    const { data: created, error: insertError } = await supabase
        .from('balances')
        .insert([newUser])
        .select()
        .single();

    if (insertError) {
        console.error('Error creating user in Supabase:', insertError);
        return newUser;
    }

    return created;
}

// Adjusts win probability dynamically based on loss streaks
async function evaluateMartingaleAndGetWinRate(user, betAmount, baseWinRate) {
    const lossStreak = user.loss_streak || 0;
    let adjustedRate = baseWinRate;

    if (lossStreak >= 3) {
        adjustedRate = Math.min(baseWinRate + (lossStreak * 2), 75);
    }
    return adjustedRate;
}

// Logs bets, updates loss streaks, rakeback, and referral commission
async function processBet(user, betAmount, isWin) {
    const rakebackEarned = Math.floor(betAmount * 0.005); // 0.5% Rakeback
    const newLossStreak = isWin ? 0 : (user.loss_streak || 0) + 1;

    let updates = {
        rakeback: (user.rakeback || 0) + rakebackEarned,
        loss_streak: newLossStreak
    };

    if (user.wager_required && user.wager_required > 0) {
        updates.wager_required = Math.max(0, user.wager_required - betAmount);
    }

    await supabase.from('balances').update(updates).eq('user_id', user.user_id);

    // Pay 2% referral loss commission if applicable
    if (!isWin && user.referred_by) {
        const refBonus = Math.floor(betAmount * 0.02);
        const { data: referrer } = await supabase.from('balances').select('*').eq('user_id', user.referred_by).single();
        if (referrer) {
            await supabase.from('balances').update({ balance: (referrer.balance || 0) + refBonus }).eq('user_id', user.referred_by);
        }
    }
}

module.exports = {
    parseAmount,
    getOrCreateUser,
    evaluateMartingaleAndGetWinRate,
    processBet
};
