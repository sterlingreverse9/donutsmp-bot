const express = require('express');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ALLOWED_PREFIXES = ['!', '$', '/'];

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
            .insert([{ user_id: userId, username, balance: 0, claimed_starter: false, rakeback: 0, wager_required: 0 }])
            .select()
            .single();
        return newUser;
    }
    return data;
}

// Rakeback & Wager tracking helper
async function processBet(user, betAmount) {
    const rakebackEarned = Math.floor(betAmount * 0.005); // 0.5%
    const newRakeback = (user.rakeback || 0) + rakebackEarned;
    const newWager = Math.max(0, (user.wager_required || 0) - betAmount);

    await supabase.from('balances').update({
        rakeback: newRakeback,
        wager_required: newWager
    }).eq('user_id', user.user_id);
}

// Win determination helper considering custom win rates
function calculateWin(user, defaultWinProbability) {
    if (user.custom_win_rate !== null && user.custom_win_rate !== undefined) {
        const roll = Math.random() * 100;
        return roll < user.custom_win_rate;
    }
    return Math.random() < defaultWinProbability;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Owner check for admin commands
    const isAdmin = message.author.id === process.env.ADMIN_DISCORD_ID;

    // 1. /help
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📜 Donut Bet - Command List')
            .setDescription('Here is a list of all available commands across `!`, `$`, and `/` prefixes:')
            .addFields(
                { name: '💰 Account Commands', value: '`/start` - Welcome bonus ($1M free first time)\n`/bal` - Check balance and stats\n`/wager` - Check remaining wagering requirement\n`/rakeback [claim]` - View or claim 0.5% bet rakeback' },
                { name: '📥 Banking', value: '`/depo <IGN> <Amount>` - Request deposit (e.g. 500k, 5m)\n`/deposithistory` - View last 5 deposit requests' },
                { name: '🎲 Games', value: '`/limbo <Amount> <Multiplier>` - Target multiplier game (e.g. `/limbo 100k 2.5x`)\n`/cf <Amount> <heads/tails>` - Coinflip game with animation' },
                { name: '👑 Admin Commands', value: '`/addbalance <@user/ID> <Amount>` - Add balance to player\n`/win` - (DM Only) Control player win probabilities' }
            )
            .setFooter({ text: 'Need additional assistance? Contact owner: @Piyushh_Rao' });

        return message.reply({ embeds: [embed] });
    }

    // 2. /bal
    if (command === 'bal' || command === 'balance') {
        try {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle(`💰 ${message.author.username}'s Profile`)
                .addFields(
                    { name: 'Balance', value: `$${user.balance.toLocaleString()}`, inline: true },
                    { name: 'Rakeback', value: `$${(user.rakeback || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Left', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
                );
            return message.reply({ embeds: [embed] });
        } catch (err) {
            return message.reply('❌ Error fetching balance.');
        }
    }

    // 3. /start
    if (command === 'start') {
        try {
            let user = await getOrCreateUser(message.author.id, message.author.username);

            if (!user.claimed_starter) {
                const newBal = user.balance + 1000000;
                await supabase
                    .from('balances')
                    .update({ balance: newBal, claimed_starter: true })
                    .eq('user_id', message.author.id);

                const embed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('🎉 Welcome to Donut Bet!')
                    .setDescription(`Welcome! You've claimed your **$1,000,000** free starter balance.\n\n**Current Balance:** $${newBal.toLocaleString()}`);
                return message.reply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setColor('#3498DB')
                    .setTitle('👋 Welcome Back!')
                    .setDescription(`Welcome back, ${message.author.username}!\n\n*(You have already claimed your starter bonus)*`);
                return message.reply({ embeds: [embed] });
            }
        } catch (err) {
            return message.reply('❌ Error processing starter command.');
        }
    }

    // 4. /rakeback
    if (command === 'rakeback') {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const subCommand = args[0] ? args[0].toLowerCase() : '';

        if (subCommand === 'claim') {
            const amountToClaim = user.rakeback || 0;
            if (amountToClaim <= 0) {
                return message.reply('❌ You have no rakeback balance to claim.');
            }

            await supabase.from('balances').update({
                balance: user.balance + amountToClaim,
                rakeback: 0
            }).eq('user_id', message.author.id);

            return message.reply(`🎉 Claimed **$${amountToClaim.toLocaleString()}** from rakeback into your balance!`);
        }

        const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🎰 Rakeback Overview')
            .setDescription(`Unclaimed Rakeback: **$${(user.rakeback || 0).toLocaleString()}**\n\nRun \`${prefix}rakeback claim\` to add this to your playable balance.`);
        return message.reply({ embeds: [embed] });
    }

    // 5. /wager
    if (command === 'wager') {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const wagerLeft = user.wager_required || 0;

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('📊 Wagering Status')
            .setDescription(wagerLeft > 0 
                ? `You need to wager **$${wagerLeft.toLocaleString()}** more before requesting a withdrawal.` 
                : '✅ You have completed all wagering requirements!');
        return message.reply({ embeds: [embed] });
    }

    // 6. /addbalance (Admin Only)
    if (command === 'addbalance') {
        if (!isAdmin) return message.reply('❌ Only the bot owner can use this command.');

        const targetMention = message.mentions.users.first();
        const targetId = targetMention ? targetMention.id : args[0];
        const rawAmount = targetMention ? args[1] : args[1];
        const amount = parseAmount(rawAmount);

        if (!targetId || !amount) {
            return message.reply(`❌ **Usage:** \`${prefix}addbalance <@user/UserID> <amount>\``);
        }

        const user = await getOrCreateUser(targetId, 'User');
        const newBal = user.balance + amount;
        await supabase.from('balances').update({ balance: newBal }).eq('user_id', targetId);

        return message.reply(`✅ Added **$${amount.toLocaleString()}** to <@${targetId}>. New balance: **$${newBal.toLocaleString()}**`);
    }

    // 7. /deposit
    if (command === 'deposit' || command === 'depo') {
        const mcUsername = args[0];
        const rawAmount = args[1];
        const amount = parseAmount(rawAmount);

        if (!mcUsername || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <MC_IGN> <Amount>\` (e.g. \`${prefix}${command} Player123 500k\`)`);
        }

        const { data: depRecord } = await supabase
            .from('deposits')
            .insert([{ user_id: message.author.id, mc_username: mcUsername, amount, status: 'pending' }])
            .select()
            .single();

        const depositId = depRecord ? depRecord.id : 'N/A';

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('📥 Deposit Request')
            .setDescription(`Send **$${amount.toLocaleString()}** in-game to complete your deposit.`)
            .addFields(
                { name: 'Minecraft IGN', value: `\`${mcUsername}\``, inline: true },
                { name: 'Amount', value: `$${amount.toLocaleString()}`, inline: true }
            )
            .setFooter({ text: 'Click "I Paid" below once you send the money in-game.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`paid_${depositId}_${message.author.id}_${mcUsername}_${amount}`)
                .setLabel('I Paid')
                .setStyle(ButtonStyle.Success)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // 8. /deposithistory
    if (command === 'deposithistory' || command === 'depohistory') {
        try {
            const { data: history } = await supabase
                .from('deposits')
                .select('*')
                .eq('user_id', message.author.id)
                .order('created_at', { ascending: false })
                .limit(5);

            if (!history || history.length === 0) {
                return message.reply('📜 You have no deposit history yet.');
            }

            const historyText = history.map(d => 
                `• **$${d.amount.toLocaleString()}** | IGN: \`${d.mc_username}\` | Status: **${d.status.toUpperCase()}**`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle('📜 Deposit History (Last 5)')
                .setDescription(historyText);

            return message.reply({ embeds: [embed] });
        } catch (err) {
            return message.reply('❌ Error fetching deposit history.');
        }
    }

    // 9. /limbo
    if (command === 'limbo') {
        const rawAmount = args[0];
        const rawTarget = args[1] ? args[1].replace('x', '') : null;
        const betAmount = parseAmount(rawAmount);
        const targetMult = parseFloat(rawTarget);

        if (!betAmount || !targetMult || targetMult < 1.01) {
            return message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` (e.g. \`${prefix}limbo 100k 2.0x\`)`);
        }

        const user = await getOrCreateUser(message.author.id, message.author.username);
        if (user.balance < betAmount) {
            return message.reply('❌ You do not have enough balance to place this bet.');
        }

        // Standard probability formula for Limbo
        const winProb = (1 / targetMult) * 0.99; // 1% house edge
        const isWin = calculateWin(user, winProb);

        let finalMultiplier;
        if (isWin) {
            finalMultiplier = (targetMult + (Math.random() * 2)).toFixed(2);
        } else {
            finalMultiplier = (1 + (Math.random() * (targetMult - 1.01))).toFixed(2);
        }

        const payout = isWin ? Math.floor(betAmount * targetMult) : 0;
        const netChange = isWin ? (payout - betAmount) : -betAmount;
        const newBalance = user.balance + netChange;

        await supabase.from('balances').update({ balance: newBalance }).eq('user_id', message.author.id);
        await processBet(user, betAmount);

        const embed = new EmbedBuilder()
            .setColor(isWin ? '#2ECC71' : '#E74C3C')
            .setTitle(`🚀 Limbo | Result: ${finalMultiplier}x`)
            .setDescription(isWin 
                ? `🎉 **Target Hit!** You won **$${payout.toLocaleString()}**!` 
                : `💥 **Crashed at ${finalMultiplier}x!** You lost $${betAmount.toLocaleString()}.`)
            .addFields(
                { name: 'Target', value: `${targetMult}x`, inline: true },
                { name: 'New Balance', value: `$${newBalance.toLocaleString()}`, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // 10. /cf, /coin, /flip
    if (['cf', 'coin', 'flip'].includes(command)) {
        const rawAmount = args[0];
        const choiceInput = args[1] ? args[1].toLowerCase() : null;
        const betAmount = parseAmount(rawAmount);

        let choice = null;
        if (['head', 'heads', 'h'].includes(choiceInput)) choice = 'heads';
        if (['tail', 'tails', 't'].includes(choiceInput)) choice = 'tails';

        if (!betAmount || !choice) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <amount> <heads/tails>\` (e.g. \`${prefix}${command} 100k heads\`)`);
        }

        const user = await getOrCreateUser(message.author.id, message.author.username);
        if (user.balance < betAmount) {
            return message.reply('❌ You do not have enough balance.');
        }

        const isWin = calculateWin(user, 0.49); // 49% standard win chance
        const winningSide = isWin ? choice : (choice === 'heads' ? 'tails' : 'heads');

        // Initial suspense message
        const replyMsg = await message.reply('🪙 Flipping coin... 🪙');
        const flips = ['🪙 Flipping... [ Heads ]', '🪙 Flipping... [ Tails ]', '🪙 Flipping... [ Heads ]'];

        for (const state of flips) {
            await new Promise(r => setTimeout(r, 600));
            await replyMsg.edit(state);
        }

        const payout = isWin ? betAmount * 2 : 0;
        const netChange = isWin ? betAmount : -betAmount;
        const newBalance = user.balance + netChange;

        await supabase.from('balances').update({ balance: newBalance }).eq('user_id', message.author.id);
        await processBet(user, betAmount);

        const embed = new EmbedBuilder()
            .setColor(isWin ? '#2ECC71' : '#E74C3C')
            .setTitle(`🪙 Coinflip Result: ${winningSide.toUpperCase()}`)
            .setDescription(isWin 
                ? `🎉 You guessed correctly and won **$${payout.toLocaleString()}**!` 
                : `💥 It landed on **${winningSide}**. You lost $${betAmount.toLocaleString()}.`)
            .addFields({ name: 'New Balance', value: `$${newBalance.toLocaleString()}` });

        return replyMsg.edit({ content: ' ', embeds: [embed] });
    }

    // 11. /win (Admin DM Only Control Panel)
    if (command === 'win') {
        if (message.channel.type !== 1) { // 1 = DM Channel
            return message.reply('❌ This command can only be used in direct messages (DM).');
        }
        if (!isAdmin) {
            return message.reply('❌ Unauthorized command.');
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('set_win_rate')
            .setPlaceholder('Select target win rate percentage')
            .addOptions([
                { label: '0% Win Rate (Rig to Lose)', value: '0' },
                { label: '30% Win Rate', value: '30' },
                { label: '50% Normal Win Rate', value: '50' },
                { label: '70% High Win Rate', value: '70' },
                { label: '90% Win Rate (Rig to Win)', value: '90' },
                { label: 'Reset to Default (Un-rig)', value: 'reset' }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return message.reply({ content: '⚙️ **Win Rate Control Panel**\nSpecify target user ID in arguments or select default setting below:', components: [row] });
    }
});

// Admin Control Panel Selection Handler
client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId === 'set_win_rate') {
        const val = interaction.values[0];
        const valNum = val === 'reset' ? null : parseInt(val);

        await interaction.reply({
            content: `Enter the target user's Discord ID in DM like this to set win rate to **${val}%**:\n\`!setwinrate <UserID> ${val}\``,
            ephemeral: true
        });
    }
});

// Internal helper for setting custom win rate
client.on('messageCreate', async (message) => {
    if (message.channel.type === 1 && message.author.id === process.env.ADMIN_DISCORD_ID && message.content.startsWith('!setwinrate')) {
        const args = message.content.split(' ');
        const targetId = args[1];
        const rate = args[2] === 'reset' ? null : parseInt(args[2]);

        await supabase.from('balances').update({ custom_win_rate: rate }).eq('user_id', targetId);
        return message.reply(`✅ Updated <@${targetId}>'s custom win rate to: **${rate !== null ? rate + '%' : 'Default'}**.`);
    }
});

// Button Handlers for Deposits
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('paid_')) {
        const [, depositId, userId, mcUsername, amount] = interaction.customId.split('_');

        await interaction.reply({ content: '✅ Confirmation sent to Admin for verification!', ephemeral: true });

        const adminId = process.env.ADMIN_DISCORD_ID;
        if (adminId) {
            try {
                const adminUser = await client.users.fetch(adminId);
                const adminEmbed = new EmbedBuilder()
                    .setColor('#F39C12')
                    .setTitle('🔔 New Deposit Verification Needed')
                    .addFields(
                        { name: 'User', value: `<@${userId}>`, inline: true },
                        { name: 'MC IGN', value: `\`${mcUsername}\``, inline: true },
                        { name: 'Amount', value: `$${parseInt(amount).toLocaleString()}`, inline: true },
                        { name: 'Deposit ID', value: `#${depositId}`, inline: true }
                    )
                    .setTimestamp();

                const adminRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`approve_${depositId}_${userId}_${amount}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`decline_${depositId}_${userId}_${amount}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger)
                );

                await adminUser.send({ embeds: [adminEmbed], components: [adminRow] });
            } catch (err) {
                console.error('Failed to DM Admin:', err);
            }
        }
    }

    if (interaction.customId.startsWith('approve_')) {
        const [, depositId, userId, amount] = interaction.customId.split('_');
        const depositAmount = parseInt(amount);

        await supabase.from('deposits').update({ status: 'completed' }).eq('id', depositId);

        const user = await getOrCreateUser(userId, 'User');
        const newBalance = user.balance + depositAmount;
        const newWager = (user.wager_required || 0) + depositAmount; // Add 1x wager requirement

        await supabase.from('balances').update({ balance: newBalance, wager_required: newWager }).eq('user_id', userId);

        await interaction.update({
            content: `✅ **Accepted Deposit #${depositId}** for <@${userId}> ($${depositAmount.toLocaleString()}). Balance & 1x Wager updated!`,
            embeds: [],
            components: []
        });

        try {
            const targetUser = await client.users.fetch(userId);
            const userEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('🎉 Deposit Approved!')
                .setDescription(`Your deposit of **$${depositAmount.toLocaleString()}** has been accepted!\n\n**New Balance:** $${newBalance.toLocaleString()}`);
            await targetUser.send({ embeds: [userEmbed] });
        } catch (err) {
            console.error('Could not DM user:', err);
        }
    }

    if (interaction.customId.startsWith('decline_')) {
        const [, depositId, userId, amount] = interaction.customId.split('_');
        const depositAmount = parseInt(amount);

        await supabase.from('deposits').update({ status: 'declined' }).eq('id', depositId);

        await interaction.update({
            content: `❌ **Declined Deposit #${depositId}** for <@${userId}> ($${depositAmount.toLocaleString()}).`,
            embeds: [],
            components: []
        });

        try {
            const targetUser = await client.users.fetch(userId);
            const userEmbed = new EmbedBuilder()
                .setColor('#E74C3C')
                .setTitle('❌ Deposit Rejected')
                .setDescription(`Your deposit request of **$${depositAmount.toLocaleString()}** was rejected by the admin.`);
            await targetUser.send({ embeds: [userEmbed] });
        } catch (err) {
            console.error('Could not DM user:', err);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
