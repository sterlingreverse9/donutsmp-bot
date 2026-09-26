const supabase = require('../config/supabase');

async function getOrCreateUser(userId, username) {
    let { data: user } = await supabase.from('balances').select('*').eq('user_id', userId).single();

    if (!user) {
        const { data: newUser, error } = await supabase.from('balances').insert({
            user_id: userId,
            username: username || 'Unknown',
            balance: 0,
            claimed_starter_bonus: false,
            rakeback: 0,
            wager_required: 0,
            unclaimed_ref_rewards: 0,
            deposit_count: 0
        }).select().single();

        if (error) console.error('Error creating user:', error);
        return newUser;
    }

    return user;
}

function parseAmount(amountStr) {
    if (!amountStr) return null;
    let str = amountStr.toString().toLowerCase().trim();
    
    let multiplier = 1;
    if (str.endsWith('k')) {
        multiplier = 1000;
        str = str.slice(0, -1);
    } else if (str.endsWith('m')) {
        multiplier = 1000000;
        str = str.slice(0, -1);
    } else if (str.endsWith('b')) {
        multiplier = 1000000000;
        str = str.slice(0, -1);
    }

    const parsed = parseFloat(str);
    return isNaN(parsed) ? null : Math.floor(parsed * multiplier);
}

module.exports = { getOrCreateUser, parseAmount };
