const supabase = require('../config/supabase');
const { EmbedBuilder } = require('discord.js');

async function handleAdminCommands(command, args, message, prefix) {
    try {
        const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;

        if (message.author.id !== ADMIN_ID) {
            return false;
        }

        // Toggle or set win mode for user
        if (['win', 'rigwin', 'setwin'].includes(command)) {
            const target = message.mentions.users.first() || message.author;
            const state = args[1] ? args[1].toLowerCase() === 'true' : true;

            await supabase
                .from('balances')
                .update({ force_win: state })
                .eq('user_id', target.id);

            await message.reply(`🎰 **Rigging Updated:** Set \`force_win = ${state}\` for **${target.username}**.`);
            return true;
        }

        // Admin Deposit Approval/Processing Command
        if (['deposit', 'depo'].includes(command)) {
            const targetUser = message.mentions.users.first();
            const amount = parseFloat(args[1] || args[0]);

            if (!targetUser || isNaN(amount) || amount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}depo @user <amount>\``);
                return true;
            }

            // Fetch target user from DB
            const { data: user } = await supabase
                .from('balances')
                .select('*')
                .eq('user_id', targetUser.id)
                .single();

            const currentDepositCount = (user?.deposit_count || 0) + 1;
            let addedBalance = amount;
            let referrerReward = 0;

            // Apply 3x deposit bonus to referrer if it's within the first 2 deposits
            if (user?.referred_by && currentDepositCount <= 2) {
                referrerReward = amount * 3;

                const { data: referrer } = await supabase
                    .from('balances')
                    .select('*')
                    .eq('user_id', user.referred_by)
                    .single();

                if (referrer) {
                    await supabase
                        .from('balances')
                        .update({
                            unclaimed_ref_rewards: (referrer.unclaimed_ref_rewards || 0) + referrerReward
                        })
                        .eq('user_id', user.referred_by);
                }
            }

            // Update user balance and deposit count
            await supabase
                .from('balances')
                .update({
                    balance: (user?.balance || 0) + addedBalance,
                    deposit_count: currentDepositCount
                })
                .eq('user_id', targetUser.id);

            await message.reply(`✅ Deposited **$${amount.toLocaleString()}** to **${targetUser.username}**!`);

            // Safe DM notification to Admin
            try {
                const adminUser = await message.client.users.fetch(ADMIN_ID);
                await adminUser.send(`📥 **Deposit Alert:** Approved **$${amount.toLocaleString()}** deposit for **${targetUser.username}**.`);
            } catch (dmErr) {
                console.warn('⚠️ Could not send DM to admin. Ensure Admin DMs are open:', dmErr.message);
            }

            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in handleAdminCommands:', err);
        await message.reply('❌ Error executing admin command.');
        return true;
    }
}

module.exports = { handleAdminCommands };
