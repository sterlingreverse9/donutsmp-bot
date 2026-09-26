const supabase = require('../config/supabase');
const { parseAmount, getOrCreateUser } = require('../utils/helpers');

async function handleBankingCommands(command, args, message, prefix) {
    try {
        if (['pay', 'tip', 'send'].includes(command)) {
            const recipientMention = message.mentions.users.first();
            const rawAmount = args[1] || args[0];
            const amount = parseAmount(rawAmount);

            if (!recipientMention || !amount || amount <= 0) {
                await message.reply(`❌ **Usage:** \`${prefix}pay <@user> <amount>\``);
                return true;
            }

            if (recipientMention.id === message.author.id) {
                await message.reply('❌ You cannot send money to yourself!');
                return true;
            }

            const sender = await getOrCreateUser(message.author.id, message.author.username);

            if (sender.balance < amount) {
                await message.reply(`❌ Insufficient funds! Balance: **$${(sender.balance || 0).toLocaleString()}**`);
                return true;
            }

            const recipient = await getOrCreateUser(recipientMention.id, recipientMention.username);

            await supabase.from('balances').update({ balance: sender.balance - amount }).eq('user_id', sender.user_id);
            await supabase.from('balances').update({ balance: (recipient.balance || 0) + amount }).eq('user_id', recipient.user_id);

            await message.reply(`💸 Successfully paid **$${amount.toLocaleString()}** to **${recipientMention.username}**!`);
            return true;
        }

        if (['claimrakeback', 'rakeback'].includes(command)) {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const claimAmount = user.rakeback || 0;

            if (claimAmount <= 0) {
                await message.reply('❌ You have no rakeback to claim.');
                return true;
            }

            await supabase.from('balances').update({
                balance: (user.balance || 0) + claimAmount,
                rakeback: 0
            }).eq('user_id', user.user_id);

            await message.reply(`🎁 Successfully claimed **$${claimAmount.toLocaleString()}** in rakeback!`);
            return true;
        }

        return false;
    } catch (err) {
        console.error('❌ Error in handleBankingCommands:', err);
        await message.reply('❌ Error processing banking command.');
        return true;
    }
}

module.exports = { handleBankingCommands };
