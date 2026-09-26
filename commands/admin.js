const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');

async function handleAdminCommands(command, args, message, prefix) {
    try {
        if (command === 'addbal') {
            if (!message.member || !message.member.permissions.has('Administrator')) {
                await message.reply('❌ Admin permission required.');
                return true;
            }

            const targetUser = message.mentions.users.first();
            const amount = parseAmount(args[1]);

            if (!targetUser || !amount) {
                await message.reply(`❌ **Usage:** \`${prefix}addbal <@user> <amount>\``);
                return true;
            }

            const user = await getOrCreateUser(targetUser.id, targetUser.username);
            const newBal = (user.balance || 0) + amount;

            await supabase.from('balances').update({ balance: newBal }).eq('user_id', targetUser.id);
            await message.reply(`✅ Added **$${amount.toLocaleString()}** to **${targetUser.username}**. New balance: **$${newBal.toLocaleString()}**.`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in handleAdminCommands:', err);
        return true;
    }
}

module.exports = { handleAdminCommands };
