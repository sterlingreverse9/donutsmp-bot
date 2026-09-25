const supabase = require('../config/supabase');

function parseAmount(input) {
    if (!input) return null;
    const cleanStr = input.toString().toLowerCase().trim();
    const match = cleanStr.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
    if (!match) return isNaN(cleanStr) ? null : parseInt(cleanStr);
    
    let val = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'k') val *= 1000;
    if (unit === 'm') val *= 1000000;
    if (unit === 'b') val *= 1000000000;
    
    return Math.floor(val);
}

async function getOrCreateUser(userId, username) {
    let { data } = await supabase
        .from('balances')
        .select('*')
        .eq('user_id', userId)
        .single();

    if (!data) {
        const { data: newUser } = await supabase
            .from('balances')
            .insert([{ 
                user_id: userId, 
                username, 
                balance: 0, 
                claimed_starter: false, 
                rakeback: 0, 
                wager_required: 0,
                last_bet_amount: 0,
                last_bet_won: true,
                martingale_streak: 0
            }])
            .select()
            .single();
        return newUser;
    }
    return data;
}

async function findTargetUser(input, mention) {
    if (mention) return await getOrCreateUser(mention.id, mention.username);
    if (!input) return null;

    const cleanInput = input.replace(/[<@!>]/g, '').trim();

    let { data } = await supabase.from('balances').select('*').eq('user_id', cleanInput).single();
    if (data) return data;

    let { data: nameData } = await supabase.from('balances').select('*').ilike('username', cleanInput).single();
    return nameData || null;
}

async function evaluateMartingaleAndGetWinRate(user, betAmount, baseWinRate) {
    let streak = user.martingale_streak || 0;
    const lastAmount = user.last_bet_amount || 0;
    const lastWon = user.last_bet_won !== false;

    if (!lastWon && lastAmount > 0 && betAmount >= Math.floor(lastAmount * 1.8)) {
        streak += 1;
    } else {
        streak = 0;
    }

    await supabase.from('balances').update({ martingale_streak: streak }).eq('user_id', user.user_id);

    let penaltyFactor = 1.0;
    if (streak === 2) penaltyFactor = 0.65;
    else if (streak >= 3) penaltyFactor = 0.35;

    return baseWinRate * penaltyFactor;
}

async function processBet(user, betAmount, isWin) {
    const rakebackEarned = Math.floor(betAmount * 0.0025);
    const newRakeback = (user.rakeback || 0) + rakebackEarned;
    const newWager = Math.max(0, (user.wager_required || 0) - betAmount);

    await supabase.from('balances').update({
        rakeback: newRakeback,
        wager_required: newWager,
        last_bet_amount: betAmount,
        last_bet_won: isWin
    }).eq('user_id', user.user_id);
}

module.exports = {
    parseAmount,
    getOrCreateUser,
    findTargetUser,
    evaluateMartingaleAndGetWinRate,
    processBet
};
