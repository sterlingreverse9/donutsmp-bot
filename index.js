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
    return Math.random() < (defaultWinProbability * 100);
}

client.once('ready', () => {
    console.log(`🤖 SUCCESS: Bot is online as ${client.user.tag}!`);
});

client.on('error', (err) => console.error('❌ Discord Client Error:', err));

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === process.env.ADMIN_DISCORD_ID;

    if (command === 'setgamewinrate' && isAdmin && message.channel.isDMBased()) {
        const game = args[0]?.toLowerCase();
        const rate = args[1] === 'reset' ? null : parseInt(args[1]);

        if (!game || !['limbo', 'coinflip'].includes(game)) {
            return message.reply('❌ Valid games: `limbo`, `coinflip`');
        }

        await supabase.from('game_settings').upsert({ game_name: game, win_rate: rate });
        return message.reply(`✅ Updated **${game.toUpperCase()}** global win rate to: **${rate !== null ? rate + '%' : 'Default (45%)'}**.`);
    }

    // 1. Help
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📜 Donut Bet - Command List')
            .setDescription('Available commands across `!`, `$`, and `/` prefixes:')
            .addFields(
                { name: '💰 Account Commands', value: '`/start` - Claim starter bonus ($1M)\n`/bal` - Check balance & stats\n`/link <MC_IGN>` - Link default Minecraft username\n`/wager` - Check remaining wagering requirement\n`/rakeback [claim]` - View or claim 0.5% bet rakeback\n`/pay` or `/tip` - Tip another user (or reply to tip)' },
                { name: '📥 Banking', value: '`/depo [IGN] <Amount>` - Request deposit\n`/withdraw <Amount> [IGN]` - Request withdrawal\n`/deposithistory` - View last 5 deposits' },
                { name: '🎲 Games', value: '`/limbo <Amount> <Multiplier>` - Target multiplier game\n`/cf <Amount> <heads/tails>` - Animated coinflip' }
            )
            .setFooter({ text: 'Need additional assistance? Contact owner: @Piyushh_Rao' });

        return message.reply({ embeds: [embed] });
    }

    // 2. Link MC Username
    if (command === 'link') {
        const mcUsername = args[0];
        if (!mcUsername) {
            return message.reply(`❌ **Usage:** \`${prefix}link <MC_IGN>\``);
        }

        await getOrCreateUser(message.author.id, message.author.username);
        await supabase.from('balances').update({ mc_username: mcUsername }).eq('user_id', message.author.id);

        return message.reply(`✅ Successfully linked Minecraft IGN **\`${mcUsername}\`** to your account!`);
    }

    // 3. Balance
    if (command === 'bal' || command === 'balance') {
        try {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle(`💰 ${message.author.username}'s Profile`)
                .addFields(
                    { name: 'Balance', value: `$${user.balance.toLocaleString()}`, inline: true },
                    { name: 'Linked IGN', value: user.mc_username ? `\`${user.mc_username}\`` : 'None (`/link`)', inline: true },
                    { name: 'Rakeback', value: `$${(user.rakeback || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Left', value: `$${(user.wager_required || 0).toLocaleString()}`, inline: true }
                );
            return message.reply({ embeds: [embed] });
        } catch (err) {
            return message.reply('❌ Error fetching balance.');
        }
    }

    // 4. Start
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

    // 5. Withdraw Command
    if (['withdraw', 'with'].includes(command)) {
        const rawAmount = args[0];
        const rawMcUsername = args[1];

        const amount = parseAmount(rawAmount);
        const user = await getOrCreateUser(message.author.id, message.author.username);

        const mcUsername = rawMcUsername || user.mc_username;

        if (!amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <amount> [MC_IGN]\``);
        }

        if (!mcUsername) {
            return message.reply(`❌ No Minecraft username provided or linked. Use \`${prefix}link <MC_IGN>\` or specify it in the command.`);
        }

        if ((user.wager_required || 0) > 0) {
            return message.reply(`❌ You cannot withdraw yet! You still need to wager **$${user.wager_required.toLocaleString()}**.`);
        }

        if (user.balance < amount) {
            return message.reply('❌ Insufficient balance for this withdrawal.');
        }

        // Deduct balance upfront
        await supabase.from('balances').update({ balance: user.balance - amount }).eq('user_id', message.author.id);

        // Record withdrawal request
        const { data: withRecord } = await supabase
            .from('withdrawals')
            .insert([{ user_id: message.author.id, mc_username: mcUsername, amount, channel_id: message.channel.id, status: 'pending' }])
            .select()
            .single();

        const withId = withRecord ? withRecord.id : 'N/A';

        message.reply(`⏳ Withdrawal request submitted for **$${amount.toLocaleString()}** to IGN \`${mcUsername}\`. Admin will review and pay within 30 minutes!`);

        // Send alert to Admin
        const adminId = process.env.ADMIN_DISCORD_ID;
        if (adminId) {
            try {
                const adminUser = await client.users.fetch(adminId);
                const adminEmbed = new EmbedBuilder()
                    .setColor('#E74C3C')
                    .setTitle('🔔 New Withdrawal Request')
                    .addFields(
                        { name: 'User', value: `<@${message.author.id}>`, inline: true },
                        { name: 'MC IGN', value: `\`${mcUsername}\``, inline: true },
                        { name: 'Amount', value: `$${amount.toLocaleString()}`, inline: true },
                        { name: 'Withdrawal ID', value: `#${withId}`, inline: true }
                    )
                    .setTimestamp();

                const adminRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`appwith_${withId}_${message.author.id}_${mcUsername}_${amount}_${message.channel.id}`)
                        .setLabel('Accept & Paid')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`decwith_${withId}_${message.author.id}_${amount}`)
                        .setLabel('Decline & Refund')
                        .setStyle(ButtonStyle.Danger)
                );

                await adminUser.send({ embeds: [adminEmbed], components: [adminRow] });
            } catch (err) {
                console.error('Failed to DM Admin for withdrawal:', err);
            }
        }
        return;
    }

    // 6. Deposit Command
    if (command === 'deposit' || command === 'depo') {
        let mcUsername = args[0];
        let rawAmount = args[1];

        // If user provided amount first or uses linked IGN
        if (!rawAmount && parseAmount(mcUsername)) {
            rawAmount = mcUsername;
            const user = await getOrCreateUser(message.author.id, message.author.username);
            mcUsername = user.mc_username;
        }

        const amount = parseAmount(rawAmount);

        if (!mcUsername || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} [MC_IGN] <Amount>\` (Or use \`${prefix}link <MC_IGN>\` first)`);
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

    // 7. Pay / Tip
    if (['pay', 'tip'].includes(command)) {
        let recipientUser = message.mentions.users.first();
        let amountArg = args[1];

        if (!recipientUser && message.reference) {
            try {
                const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
                recipientUser = referencedMsg.author;
                amountArg = args[0];
            } catch (err) {
                console.error(err);
            }
        }

        const amount = parseAmount(amountArg);

        if (!recipientUser || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} @user <amount>\` or reply to a message with \`${prefix}${command} <amount>\``);
        }

        if (recipientUser.id === message.author.id) return message.reply('❌ You cannot tip yourself!');
        if (recipientUser.bot) return message.reply('❌ You cannot tip bot accounts.');

        const sender = await getOrCreateUser(message.author.id, message.author.username);
        if (sender.balance < amount) return message.reply('❌ Insufficient balance for this tip.');

        const recipient = await getOrCreateUser(recipientUser.id, recipientUser.username);

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

    // 8. Rakeback
    if (command === 'rakeback') {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const subCommand = args[0] ? args[0].toLowerCase() : '';

        if (subCommand === 'claim') {
            const amountToClaim = user.rakeback || 0;
            if (amountToClaim <= 0) return message.reply('❌ You have no rakeback balance to claim.');

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

    // 9. Wager
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

    // 10. Limbo
    if (command === 'limbo') {
        const rawAmount = args[0];
        const rawTarget = args[1] ? args[1].replace('x', '') : null;
        const betAmount = parseAmount(rawAmount);
        const targetMult = parseFloat(rawTarget);

        if (!betAmount || !targetMult || targetMult < 1.01) {
            return message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <multiplier>\` (e.g. \`${prefix}limbo 100k 2.0x\`)`);
        }

        const user = await getOrCreateUser(message.author.id, message.author.username);
        if (user.balance < betAmount) return message.reply('❌ Insufficient balance.');

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

        if (!betAmount || !choice) return message.reply(`❌ **Usage:** \`${prefix}${command} <amount> <heads/tails>\``);

        const user = await getOrCreateUser(message.author.id, message.author.username);
        if (user.balance < betAmount) return message.reply('❌ Insufficient balance.');

        const isWin = await calculateWin('coinflip', 0.45);
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

    // 12. Game Win Rate Control Panel (DM Only)
    if (command === 'win') {
        if (!message.channel.isDMBased()) return message.reply('❌ Admin DM only command.');
        if (!isAdmin) return message.reply('❌ Unauthorized.');

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

// Select Menu Handlers for Steps of 5 Win Rates
client.on('interactionCreate', async (interaction) => {
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_game_for_winrate') {
            const selectedGame = interaction.values[0];

            // Build options in gaps of 5
            const rateOptions = [
                { label: 'Default (45% Win Rate)', value: 'reset' },
                { label: 'Custom (Set via command)', value: 'custom' }
            ];

            for (let i = 0; i <= 100; i += 5) {
                rateOptions.push({
                    label: `${i}\% Win Rate${i === 0 ? ' (Always Lose)' : i === 100 ? ' (Always Win)' : ''}`,
                    value: i.toString()
                });
            }

            const rateSelectMenu = new StringSelectMenuBuilder()
                .setCustomId(`set_winrate_percent_${selectedGame}`)
                .setPlaceholder(`Step 2: Set Win Rate % for ${selectedGame.toUpperCase()}`)
                .addOptions(rateOptions);

            const row = new ActionRowBuilder().addComponents(rateSelectMenu);
            return interaction.reply({
                content: `⚙️ **Setting Win Rate for ${selectedGame.toUpperCase()}**\nStep 2: Select desired win percentage:`,
                components: [row]
            });
        }

        if (interaction.customId.startsWith('set_winrate_percent_')) {
            const game = interaction.customId.replace('set_winrate_percent_', '');
            const rateVal = interaction.values[0];

            if (rateVal === 'custom') {
                return interaction.reply({
                    content: `To set a custom win rate (e.g. 47%), send this command here in DM:\n\`!setgamewinrate ${game} 47\``
                });
            }

            const rate = rateVal === 'reset' ? null : parseInt(rateVal);
            await supabase.from('game_settings').upsert({ game_name: game, win_rate: rate });

            return interaction.reply({
                content: `✅ Updated **${game.toUpperCase()}** global win rate to **${rate !== null ? rate + '%' : 'Default (45%)'}**!`
            });
        }
    }

    if (!interaction.isButton()) return;

    // Withdrawal Buttons Processing
    if (interaction.customId.startsWith('appwith_')) {
        const [, withId, userId, mcUsername, amount, channelId] = interaction.customId.split('_');
        const withAmount = parseInt(amount);

        await supabase.from('withdrawals').update({ status: 'completed' }).eq('id', withId);

        await interaction.update({
            content: `✅ **Accepted & Paid Withdrawal #${withId}** for <@${userId}> ($${withAmount.toLocaleString()}).`,
            embeds: [],
            components: []
        });

        // Send DM to user
        try {
            const targetUser = await client.users.fetch(userId);
            const userEmbed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('🎉 Withdrawal Sent!')
                .setDescription(`Your withdrawal of **$${withAmount.toLocaleString()}** to Minecraft IGN \`${mcUsername}\` has been processed and paid!`);
            await targetUser.send({ embeds: [userEmbed] });
        } catch (err) {
            console.error('Could not DM user regarding withdrawal:', err);
        }

        // Send announcement in play area channel
        try {
            const playChannel = await client.channels.fetch(channelId);
            if (playChannel) {
                const publicEmbed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('💸 Successful Withdrawal')
                    .setDescription(`User **<@${userId}>** received **$${withAmount.toLocaleString()}** withdrawal to IGN \`${mcUsername}\`!`);
                await playChannel.send({ embeds: [publicEmbed] });
            }
        } catch (err) {
            console.error('Could not post public withdrawal notice:', err);
        }
    }

    if (interaction.customId.startsWith('decwith_')) {
        const [, withId, userId, amount] = interaction.customId.split('_');
        const withAmount = parseInt(amount);

        await supabase.from('withdrawals').update({ status: 'declined' }).eq('id', withId);

        // Refund deducted amount
        const user = await getOrCreateUser(userId, 'User');
        await supabase.from('balances').update({ balance: user.balance + withAmount }).eq('user_id', userId);

        await interaction.update({
            content: `❌ **Declined Withdrawal #${withId}**. Refunded **$${withAmount.toLocaleString()}** back to <@${userId}>.`,
            embeds: [],
            components: []
        });

        // Send DM to user
        try {
            const targetUser = await client.users.fetch(userId);
            await targetUser.send(`❌ Your withdrawal request of **$${withAmount.toLocaleString()}** was declined. The funds have been returned to your balance.`);
        } catch (err) {
            console.error('Could not DM user regarding declined withdrawal:', err);
        }
    }

    // Deposit Processing
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
