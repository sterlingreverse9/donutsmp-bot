const supabase = require('../config/supabase');
const { parseAmount } = require('../utils/helpers');
const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

async function handleAdminCommands(command, args, message, prefix) {
    try {
        const ADMIN_ID = process.env.ADMIN_ID || process.env.ADMIN_DISCORD_ID;

        // Verify Admin Privileges
        if (message.author.id !== ADMIN_ID) {
            return false;
        }

        // --- ADD BALANCE COMMAND ---
        if (['addbal', 'addbalance', 'givebal'].includes(command)) {
            const targetUser = message.mentions.users.first() || (args[0] ? await message.client.users.fetch(args[0]).catch(() => null) : null);
            const rawAmount = message.mentions.users.first() ? args[1] : args[1];

            if (!targetUser || !rawAmount) {
                await message.reply(`❌ **Usage:** \`${prefix}addbal @user <amount>\` or \`${prefix}addbal <User_ID> <amount>\``);
                return true;
            }

            const amount = parseAmount(rawAmount);
            if (!amount || amount <= 0) {
                await message.reply('❌ Invalid amount specified.');
                return true;
            }

            const { data: user } = await supabase.from('balances').select('*').eq('user_id', targetUser.id).single();
            const currentBal = user?.balance || 0;
            const newBal = currentBal + amount;

            await supabase.from('balances').upsert({
                user_id: targetUser.id,
                username: targetUser.username,
                balance: newBal
            });

            await message.reply(`✅ Added **$${amount.toLocaleString()}** to ${targetUser.username}'s balance! New balance: **$${newBal.toLocaleString()}**.`);
            return true;
        }

        // --- DEDUCT BALANCE COMMAND ---
        if (['deductbal', 'deductbalance', 'removebal', 'takebal'].includes(command)) {
            const targetUser = message.mentions.users.first() || (args[0] ? await message.client.users.fetch(args[0]).catch(() => null) : null);
            const rawAmount = message.mentions.users.first() ? args[1] : args[1];

            if (!targetUser || !rawAmount) {
                await message.reply(`❌ **Usage:** \`${prefix}deductbal @user <amount>\` or \`${prefix}deductbal <User_ID> <amount>\``);
                return true;
            }

            const amount = parseAmount(rawAmount);
            if (!amount || amount <= 0) {
                await message.reply('❌ Invalid amount specified.');
                return true;
            }

            const { data: user } = await supabase.from('balances').select('*').eq('user_id', targetUser.id).single();
            const currentBal = user?.balance || 0;
            const newBal = Math.max(0, currentBal - amount);

            await supabase.from('balances').update({ balance: newBal }).eq('user_id', targetUser.id);

            await message.reply(`✂️ Deducted **$${amount.toLocaleString()}** from ${targetUser.username}'s balance! New balance: **$${newBal.toLocaleString()}**.`);
            return true;
        }

        // --- /WIN CONFIGURATOR COMMAND ---
        if (['win', 'rig', 'riggame'].includes(command)) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_win_game')
                .setPlaceholder('Select a game to set win chances')
                .addOptions([
                    { label: 'Coinflip (cf)', value: 'cf', description: 'Configure Coinflip win odds' }
                ]);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await message.reply({
                content: '⚙️ **Admin Game Odds Configurator:** Select a game below:',
                components: [row]
            });

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
