const express = require('express');
const { 
    Client, 
    GatewayIntentBits, 
    Partials,
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('Donut Bet Bot is live!'));
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
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

async function processBet(user, betAmount) {
    const rakebackEarned = Math.floor(betAmount * 0.005);
    const newRakeback = (user.rakeback || 0) + rakebackEarned;
    const newWager = Math.max(0, (user.wager_required || 0) - betAmount);

    await supabase.from('balances').update({
        rakeback: newRakeback,
        wager_required: newWager
    }).eq('user_id', user.user_id);
}

// Fetch global win rate setting for a specific game
async function getGameWinRate(gameName) {
    const { data } = await supabase
        .from('game_settings')
        .select('win_rate')
        .eq('game_name', gameName)
        .single();
    
    return data ? data.win_rate : null;
}

async function calculateWin(gameName, defaultWinProbability) {
    const customRate = await getGameWinRate(gameName);
    if (customRate !== null && customRate !== undefined) {
        return (Math.random() * 100) < customRate;
    }
    return Math.random() < defaultWinProbability;
}

client.once('ready', () => {
    console.log(`🤖 SUCCESS: Bot is online as ${client.user.tag}!`);
});

client.on('error', (err) => {
    console.error('❌ Discord Client Error:', err);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === process.env.ADMIN_DISCORD_ID;

    // Direct command for updating game win rate from DM
    if (command === 'setgamewinrate' && isAdmin && message.channel.isDMBased()) {
        const game = args[0]?.toLowerCase();
        const rate = args[1] === 'reset' ? null : parseInt(args[1]);

        if (!game || !['limbo', 'coinflip'].includes(game)) {
            return message.reply('❌ Valid games: `limbo`, `coinflip`');
        }

        await supabase.from('game_settings').upsert({ game_name: game, win_rate: rate });
        return message.reply(`✅ Updated **${game.toUpperCase()}** global win rate to: **${rate !== null ? rate + '%' : 'Default'}**.`);
    }

    // 1. Help Command (Admin commands hidden)
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📜 Donut Bet - Command List')
            .setDescription('Available commands across `!`, `$`, and `/` prefixes:')
            .addFields(
                { name: '💰 Account Commands', value: '`/start` - Claim starter bonus ($1M)\n`/bal` - Check balance & stats\n`/wager` - Check remaining wagering requirement\n`/rakeback [claim]` - View or claim 0.5% bet rakeback\n`/pay` or `/tip` - Tip another user (or reply to tip)' },
                { name: '📥 Banking', value: '`/depo <IGN> <Amount>` - Request deposit\n`/deposithistory` - View last 5 deposits' },
                { name: '🎲 Games', value: '`/limbo <Amount> <Multiplier>` - Target multiplier game\n`/cf <Amount> <heads/tails>` - Animated coinflip' }
            )
            .setFooter({ text: 'Need additional assistance? Contact owner: @Piyushh_Rao' });

        return message.reply({ embeds: [embed] });
    }

    // 2. Balance
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

    // 3. Start (1M Starter + 1M Wager)
    if (command === 'start') {
        try {
            let user = await getOrCreateUser(message.author.id, message.author.username);

            if (!user.claimed_starter) {
                const newBal = user.balance + 1000000;
                const newWager = (user.wager_required || 0) + 1000000;

                await supabase
                    .from('balances')
                    .update({ balance: newBal, wager_required: newWager, claimed_starter: true })
                    .eq('user_id', message.author.id);

                const embed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('🎉 Welcome to Donut Bet!')
                    .setDescription(`You claimed your **$1,000,000** starter bonus!\n*(A 1x wager requirement of $1M has been added)*\n\n**Balance:** $${newBal.toLocaleString()}`);
                return message.reply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setColor('#3498DB')
                    .setTitle('👋 Welcome Back!')
                    .setDescription(`You have already claimed your starter bonus.`);
                return message.reply({ embeds: [embed] });
            }
        } catch (err) {
            return message.reply('❌ Error processing starter command.');
        }
    }

    // 4. Pay / Tip System
    if (['pay', 'tip'].includes(command)) {
        let recipientUser = message.mentions.users.first();
        let amountArg = args[1];

        // Check if command was triggered as a reply to another message
        if (!recipientUser && message.reference) {
            try {
                const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
                recipientUser = referencedMsg.author;
                amountArg = args[0]; // First argument is amount when replying
            } catch (err) {
                console.error(err);
            }
        }

        const amount = parseAmount(amountArg);

        if (!recipientUser || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} @user <amount>\` or reply to a message with \`${prefix}${command} <amount>\``);
        }

        if (recipientUser.id === message.author.id) {
            return message.reply('❌ You cannot tip yourself!');
        }

        if (recipientUser.bot) {
            return message.reply('❌ You cannot tip bot accounts.');
        }

        const sender = await getOrCreateUser(message.author.id, message.author.username);
        if (sender.balance < amount) {
            return message.reply('❌ Insufficient balance for this tip.');
        }

        const recipient = await getOrCreateUser(recipientUser.id, recipientUser.username);

        // Deduct from sender, add to recipient with 1x wager requirement on tipped amount
        await supabase.from('balances').update({ balance: sender.balance - amount }).eq('user_id', message.author.id);
        await supabase.from('balances').update({ 
            balance: recipient.balance + amount,
            wager_required: (recipient.wager_required || 0) + amount
        }).eq('user_id', recipientUser.id);

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('💸 Tip Sent!')
            .setDescription(`**${message.author.username}** sent **$${amount.toLocaleString()}** to **${recipientUser.username}**!`);

        return message.reply({ embeds: [embed] });
    }

    // 5. Rakeback
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
            .setDescription(`Unclaimed Rakeback: **$${(user.rakeback || 0).toLocaleString()}**\n\nRun \`${prefix}rakeback claim\` to add to balance.`);
        return message.reply({ embeds: [embed] });
    }

    // 6. Wager
    if (command === 'wager') {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const wagerLeft = user.wager_required || 0;

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('📊 Wagering Status')
            .setDescription(wagerLeft > 0 
                ? `You need to wager **$${wagerLeft.toLocaleString()}** more before withdrawing.` 
                : '✅ You have completed all wagering requirements!');
        return message.reply({ embeds: [embed] });
    }

    // 7. Add Balance (Admin)
    if (command === 'addbalance') {
        if (!isAdmin) return message.reply('❌ Admin only command.');

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

    // 8. Deposit
    if (command === 'deposit' || command === 'depo') {
        const mcUsername = args[0];
        const rawAmount = args[1];
        const amount = parseAmount(rawAmount);

        if (!mcUsername || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <MC_IGN> <Amount>\``);
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
            .setFooter({ text: 'Click "I Paid" below once sent.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`paid_${depositId}_${message.author.id}_${mcUsername}_${amount}`)
                .setLabel('I Paid')
                .setStyle(ButtonStyle.Success)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // 9. Deposit History
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

    // 10. Limbo (Harder Multiplier Math)
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
            return message.reply('❌ Insufficient balance.');
        }

        // Hardened win formula (5% house edge + exponential decay on higher multipliers)
        const winProb = (1 / Math.pow(targetMult, 1.05)) * 0.95;
        const isWin = await calculateWin('limbo', winProb);

        let finalMultiplier;
        if (isWin) {
            finalMultiplier = (targetMult + (Math.random() * 0.2)).toFixed(2);
        } else {
            finalMultiplier = (1 + (Math.random() * (targetMult - 1.01) * 0.8)).toFixed(2);
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

    // 11. Coinflip
    if (['cf', 'coin', 'flip'].includes(command)) {
        const rawAmount = args[0];
        const choiceInput = args[1] ? args[1].toLowerCase() : null;
        const betAmount = parseAmount(rawAmount);

        let choice = null;
        if (['head', 'heads', 'h'].includes(choiceInput)) choice = 'heads';
        if (['tail', 'tails', 't'].includes(choiceInput)) choice = 'tails';

        if (!betAmount || !choice) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <amount> <heads/tails>\``);
        }

        const user = await getOrCreateUser(message.author.id, message.author.username);
        if (user.balance < betAmount) {
            return message.reply('❌ Insufficient balance.');
        }

        const isWin = await calculateWin('coinflip', 0.49);
        const winningSide = isWin ? choice : (choice === 'heads' ? 'tails' : 'heads');

        const replyMsg = await message.reply('🪙 Flipping coin... 🪙');
        const flips = ['🪙 Flipping... [ Heads ]', '🪙 Flipping... [ Tails ]', '🪙 Flipping... [ Heads ]'];

        for (const state of flips) {
            await new Promise(r => setTimeout(r, 600));
            await replyMsg.edit(state).catch(() => {});
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

    // 12. Game-Based Win Control Panel (Admin DM Only)
    if (command === 'win') {
        if (!message.channel.isDMBased()) {
            return message.reply('❌ This command can only be used in direct messages (DM).');
        }
        if (!isAdmin) {
            return message.reply('❌ Unauthorized.');
        }

        const gameSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_game_for_winrate')
            .setPlaceholder('Step 1: Select a Game')
            .addOptions([
                { label: 'Limbo', value: 'limbo' },
                { label: 'Coinflip', value: 'coinflip' }
            ]);

        const row = new ActionRowBuilder().addComponents(gameSelectMenu);
        return message.reply({ content: '⚙️ **Win Rate Control Panel**\nStep 1: Choose which game you want to modify:', components: [row] });
    }
});

// Interactive Menu Handler for Game Win Rates
client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_game_for_winrate') {
            const selectedGame = interaction.values[0];

            const rateSelectMenu = new StringSelectMenuBuilder()
                .setCustomId(`set_winrate_percent_${selectedGame}`)
                .setPlaceholder(`Step 2: Set Win Rate % for ${selectedGame.toUpperCase()}`)
                .addOptions([
                    { label: '0% Win Rate (Always Lose)', value: '0' },
                    { label: '30% Win Rate', value: '30' },
                    { label: '50% Win Rate', value: '50' },
                    { label: '70% Win Rate', value: '70' },
                    { label: '90% Win Rate (Always Win)', value: '90' },
                    { label: 'Reset to Default', value: 'reset' }
                ]);

            const row = new ActionRowBuilder().addComponents(rateSelectMenu);
            return interaction.reply({
                content: `⚙️ **Setting Win Rate for ${selectedGame.toUpperCase()}**\nStep 2: Select the desired win percentage:`,
                components: [row]
            });
        }

        if (interaction.customId.startsWith('set_winrate_percent_')) {
            const game = interaction.customId.replace('set_winrate_percent_', '');
            const rateVal = interaction.values[0];
            const rate = rateVal === 'reset' ? null : parseInt(rateVal);

            await supabase.from('game_settings').upsert({ game_name: game, win_rate: rate });

            return interaction.reply({
                content: `✅ Updated **${game.toUpperCase()}** global win rate to **${rate !== null ? rate + '%' : 'Default'}**!`
            });
        }
    }

    if (!interaction.isButton()) return;

    // Deposit Verification Buttons
    if (interaction.customId.startsWith('paid_')) {
        const [, depositId, userId, mcUsername, amount] = interaction.customId.split('_');
        await interaction.reply({ content: '✅ Confirmation sent to Admin!', ephemeral: true });

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
                    );

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
        const newWager = (user.wager_required || 0) + depositAmount;

        await supabase.from('balances').update({ balance: newBalance, wager_required: newWager }).eq('user_id', userId);

        await interaction.update({
            content: `✅ **Accepted Deposit #${depositId}** for <@${userId}> ($${depositAmount.toLocaleString()}). Balance & Wager updated!`,
            embeds: [],
            components: []
        });
    }

    if (interaction.customId.startsWith('decline_')) {
        const [, depositId, userId, amount] = interaction.customId.split('_');
        await supabase.from('deposits').update({ status: 'declined' }).eq('id', depositId);

        await interaction.update({
            content: `❌ **Declined Deposit #${depositId}** for <@${userId}>.`,
            embeds: [],
            components: []
        });
    }
});

console.log('Initiating connection to Discord...');
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ DISCORD LOGIN FAILED:', err.message);
});
