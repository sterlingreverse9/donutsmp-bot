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
const ALLOWED_PREFIXES = ['!', '$', '/', '.'];

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

// Detection & Adjustment for Martingale Strategy
async function evaluateMartingaleAndGetWinRate(user, betAmount, baseWinRate) {
    let streak = user.martingale_streak || 0;
    const lastAmount = user.last_bet_amount || 0;
    const lastWon = user.last_bet_won !== false; // Default true if null

    // Check if player doubled (or roughly doubled) bet after a loss
    if (!lastWon && lastAmount > 0 && betAmount >= Math.floor(lastAmount * 1.8)) {
        streak += 1;
    } else {
        streak = 0; // Reset streak if they won or didn't double
    }

    // Save updated streak counter
    await supabase.from('balances').update({ martingale_streak: streak }).eq('user_id', user.user_id);

    // Apply subtle penalty factor based on Martingale streak
    let penaltyFactor = 1.0;
    if (streak === 2) {
        penaltyFactor = 0.65; // 35% reduction in win rate
    } else if (streak >= 3) {
        penaltyFactor = 0.35; // 65% reduction in win rate
    }

    return baseWinRate * penaltyFactor;
}

async function processBet(user, betAmount, isWin) {
    const rakebackEarned = Math.floor(betAmount * 0.005);
    const newRakeback = (user.rakeback || 0) + rakebackEarned;
    const newWager = Math.max(0, (user.wager_required || 0) - betAmount);

    await supabase.from('balances').update({
        rakeback: newRakeback,
        wager_required: newWager,
        last_bet_amount: betAmount,
        last_bet_won: isWin
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

    // 1. Admin Win Rate Control Panel (!win)
    if (command === 'win') {
        if (!isAdmin) return message.reply('❌ You do not have permission to use this command.');

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('⚙️ Win Rate Control Panel')
            .setDescription('Step 1: Choose which game you want to modify:');

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('admin_select_game')
                .setPlaceholder('Step 1: Select a Game')
                .addOptions([
                    { label: 'Limbo', value: 'limbo', description: 'Configure global win rate override for Limbo' },
                    { label: 'Coinflip', value: 'coinflip', description: 'Configure global win rate override for Coinflip' }
                ])
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // 2. Help Command
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('📜 Donut Bet - Command List')
            .setDescription('Available commands:')
            .addFields(
                { name: '💰 Account', value: '`/start [ref_id]` - Claim starter bonus\n`/bal` - Check balance\n`/ref` or `/refer` - Referral dashboard & claim\n`/link <MC_IGN>` - Link MC username\n`/wager` - Check wager requirement\n`/rakeback [claim]` - Rakeback menu\n`/pay` or `/tip` - Tip user' }[span_0](start_span)[span_0](end_span),
                { name: '📥 Banking', value: '`/depo [IGN] <Amount>` - Deposit request\n`/withdraw <Amount> [IGN]` - Withdrawal request' }[span_1](start_span)[span_1](end_span),
                { name: '🎲 Games', value: '`/limbo <Amount> <Multiplier>` - Limbo game\n`/cf <Amount> <heads/tails>` - Coinflip game' }[span_2](start_span)[span_2](end_span)
            );

        return message.reply({ embeds: [embed] });
    }

    // 3. Start Command
    if (command === 'start') {
        try {
            let user = await getOrCreateUser(message.author.id, message.author.username);
            const refCode = args[0];

            if (!user.claimed_starter) {
                let refNotice = '';

                if (refCode && refCode !== message.author.id && !user.referred_by) {
                    const { data: referrer } = await supabase
                        .from('balances')
                        .select('*')
                        .eq('user_id', refCode)
                        .single();

                    if (referrer) {
                        await supabase.from('balances').update({ referred_by: refCode }).eq('user_id', message.author.id);
                        
                        await supabase.from('referrals').insert([{
                            referrer_id: refCode,
                            referred_id: message.author.id,
                            referred_username: message.author.username,
                            qualifying_deposit_done: false
                        }]);

                        refNotice = `\n\n🔗 Linked as referral under <@${refCode}>!`;

                        try {
                            const referrerUser = await client.users.fetch(refCode);
                            if (referrerUser) {
                                await referrerUser.send(`🎉 **New Referral Joined!** User **${message.author.username}** (<@${message.author.id}>) registered using your referral command!`);
                            }
                        } catch (err) { console.error(err); }
                    }
                }

                const newBal = user.balance + 1000000;
                const newWager = (user.wager_required || 0) + 1000000;

                await supabase
                    .from('balances')
                    .update({ balance: newBal, wager_required: newWager, claimed_starter: true })
                    .eq('user_id', message.author.id);

                const embed = new EmbedBuilder()
                    .setColor('#2ECC71')
                    .setTitle('🎉 Welcome to Donut Bet!')
                    .setDescription(`You claimed your **$1,000,000** starter bonus!${refNotice}\n\n**Balance:** $${newBal.toLocaleString()}`);
                return message.reply({ embeds: [embed] });
            } else {
                return message.reply('👋 You have already claimed your starter bonus.');
            }
        } catch (err) {
            console.error(err);
            return message.reply('❌ Error processing starter command.');
        }
    }

    // 4. Referral Command
    if (['ref', 'refer'].includes(command)) {
        const user = await getOrCreateUser(message.author.id, message.author.username);

        const { data: refList } = await supabase
            .from('referrals')
            .select('*')
            .eq('referrer_id', message.author.id);

        const totalRefs = refList ? refList.length : 0;
        const refNames = refList && refList.length > 0 
            ? refList.map((r, idx) => `${idx + 1}. **${r.referred_username || 'User'}** (<@${r.referred_id}>) -${r.qualifying_deposit_done ? '✅ Qualified' : '⏳ Pending Deposit ($15M+)'}`).join('\n')
            : 'No referred users yet.';

        const refLink = `Use command: \`${prefix}start ${message.author.id}\``;
        const pendingReward = user.unclaimed_ref_rewards || 0;

        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle('🤝 Referral Dashboard')
            .setDescription(`Invite friends to earn **$30,000,000** for every friend who deposits **$15,000,000** or more!`)
            .addFields(
                { name: 'Your Referral Command', value: refLink, inline: false },
                { name: 'Total Referrals', value: `${totalRefs} Users`, inline: true },
                { name: 'Unclaimed Rewards', value: `$${pendingReward.toLocaleString()}`, inline: true },
                { name: 'Referred Users', value: refNames, inline: false }
            );

        const components = [];
        if (pendingReward > 0) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`claim_ref_${message.author.id}`)
                    .setLabel(`Claim $${pendingReward.toLocaleString()}`)
                    .setStyle(ButtonStyle.Success)
            );
            components.push(row);
        }

        return message.reply({ embeds: [embed], components });
    }

    // 5. Link MC Username
    if (command === 'link') {
        const mcUsername = args[0];
        if (!mcUsername) return message.reply(`❌ **Usage:** \`${prefix}link <MC_IGN>\``);

        await getOrCreateUser(message.author.id, message.author.username);
        await supabase.from('balances').update({ mc_username: mcUsername }).eq('user_id', message.author.id);

        return message.reply(`✅ Successfully linked Minecraft IGN **\`${mcUsername}\`**!`);
    }

    // 6. Balance Command
    if (command === 'bal' || command === 'balance') {
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
    }

    // 7. Deposit Command
    if (command === 'deposit' || command === 'depo') {
        let mcUsername = args[0];
        let rawAmount = args[1];

        if (!rawAmount && parseAmount(mcUsername)) {
            rawAmount = mcUsername;
            const user = await getOrCreateUser(message.author.id, message.author.username);
            mcUsername = user.mc_username;
        }

        const amount = parseAmount(rawAmount);

        if (!mcUsername || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} [MC_IGN] <Amount>\``);
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
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`approve_${depositId}_${message.author.id}_${amount}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline_${depositId}_${message.author.id}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // 8. Withdraw Command
    if (['withdraw', 'with'].includes(command)) {
        const rawAmount = args[0];
        const rawMcUsername = args[1];
        const amount = parseAmount(rawAmount);
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const mcUsername = rawMcUsername || user.mc_username;

        if (!amount || amount <= 0 || !mcUsername) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <amount> [MC_IGN]\``);
        }

        if ((user.wager_required || 0) > 0) {
            return message.reply(`❌ You still need to wager **$${user.wager_required.toLocaleString()}** before withdrawing.`);
        }

        if (user.balance < amount) return message.reply('❌ Insufficient balance.');

        await supabase.from('balances').update({ balance: user.balance - amount }).eq('user_id', message.author.id);

        const { data: withRecord } = await supabase
            .from('withdrawals')
            .insert([{ user_id: message.author.id, mc_username: mcUsername, amount, channel_id: message.channel.id, status: 'pending' }])
            .select()
            .single();

        const withId = withRecord ? withRecord.id : 'N/A';
        message.reply(`⏳ Withdrawal submitted for **$${amount.toLocaleString()}** to IGN \`${mcUsername}\`.`);

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
                        { name: 'Amount', value: `$${amount.toLocaleString()}`, inline: true }
                    );

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
            } catch (err) { console.error(err); }
        }
        return;
    }

    // 9. Pay / Tip Command
    if (['pay', 'tip'].includes(command)) {
        let recipientUser = message.mentions.users.first();
        let amountArg = args[1];

        if (!recipientUser && message.reference) {
            try {
                const referencedMsg = await message.channel.messages.fetch(message.reference.messageId);
                recipientUser = referencedMsg.author;
                amountArg = args[0];
            } catch (err) { console.error(err); }
        }

        const amount = parseAmount(amountArg);
        if (!recipientUser || !amount || amount <= 0) return message.reply(`❌ **Usage:** \`${prefix}${command} @user <amount>\``);
        if (recipientUser.id === message.author.id || recipientUser.bot) return message.reply('❌ Invalid target user.');

        const sender = await getOrCreateUser(message.author.id, message.author.username);
        if (sender.balance < amount) return message.reply('❌ Insufficient balance.');

        const recipient = await getOrCreateUser(recipientUser.id, recipientUser.username);

        await supabase.from('balances').update({ balance: sender.balance - amount }).eq('user_id', message.author.id);
        await supabase.from('balances').update({ 
            balance: recipient.balance + amount,
            wager_required: (recipient.wager_required || 0) + amount
        }).eq('user_id', recipientUser.id);

        return message.reply(`💸 **${message.author.username}** sent **$${amount.toLocaleString()}** to **${recipientUser.username}**!`);
    }

    // 10. Rakeback Command
    if (command === 'rakeback') {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const subCommand = args[0] ? args[0].toLowerCase() : '';

        if (subCommand === 'claim') {
            const amountToClaim = user.rakeback || 0;
            if (amountToClaim <= 0) return message.reply('❌ No rakeback to claim.');

            await supabase.from('balances').update({ balance: user.balance + amountToClaim, rakeback: 0 }).eq('user_id', message.author.id);
            return message.reply(`🎉 Claimed **$${amountToClaim.toLocaleString()}** rakeback!`);
        }

        const embed = new EmbedBuilder()
            .setColor('#E67E22')
            .setTitle('🎰 Rakeback Overview')
            .setDescription(`Unclaimed Rakeback: **$${(user.rakeback || 0).toLocaleString()}**\nUse \`${prefix}rakeback claim\` to claim.`);
        return message.reply({ embeds: [embed] });
    }

    // 11. Wager Command
    if (command === 'wager') {
        const user = await getOrCreateUser(message.author.id, message.author.username);
        const wagerLeft = user.wager_required || 0;
        return message.reply(wagerLeft > 0 ? `📊 Remaining wager required: **$${wagerLeft.toLocaleString()}**` : '✅ All wagering requirements completed!');
    }

    // 12. Limbo Command (With Anti-Martingale & Global Win Overrides)
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

        let minRate, maxRate;
        if (targetMult >= 1.01 && targetMult <= 1.10) { minRate = 81.82; maxRate = 89.11; }
        else if (targetMult >= 1.11 && targetMult <= 1.20) { minRate = 75.00; maxRate = 81.08; }
        else if (targetMult >= 1.21 && targetMult <= 1.50) { minRate = 60.00; maxRate = 74.38; }
        else if (targetMult >= 1.51 && targetMult <= 2.00) { minRate = 45.00; maxRate = 59.60; }
        else if (targetMult >= 2.01 && targetMult <= 2.50) { minRate = 36.00; maxRate = 44.78; }
        else if (targetMult >= 2.51 && targetMult <= 3.00) { minRate = 30.00; maxRate = 35.86; }
        else if (targetMult >= 3.01 && targetMult <= 4.00) { minRate = 22.50; maxRate = 29.90; }
        else if (targetMult >= 4.01 && targetMult <= 5.00) { minRate = 18.00; maxRate = 22.44; }
        else if (targetMult >= 5.01 && targetMult <= 7.50) { minRate = 12.00; maxRate = 17.96; }
        else if (targetMult >= 7.51 && targetMult <= 10.00) { minRate = 9.00; maxRate = 11.98; }
        else if (targetMult >= 10.01 && targetMult <= 20.00) { minRate = 4.50; maxRate = 8.99; }
        else if (targetMult >= 20.01 && targetMult <= 50.00) { minRate = 1.80; maxRate = 4.50; }
        else if (targetMult >= 50.01 && targetMult <= 100.00) { minRate = 0.90; maxRate = 1.80; }
        else { minRate = 0.01; maxRate = 0.89; }

        let baseWinPercentage = minRate + (Math.random() * (maxRate - minRate));
        
        // Admin override check
        const customRate = await getGameWinRate('limbo');
        if (customRate !== null && customRate !== undefined) {
            baseWinPercentage = customRate;
        }

        // Apply Martingale penalty factor
        const finalWinPercentage = await evaluateMartingaleAndGetWinRate(user, betAmount, baseWinPercentage);

        const roll = Math.random() * 100;
        const isWin = roll < finalWinPercentage;

        let finalMultiplier;
        if (isWin) {
            finalMultiplier = (targetMult + (Math.random() * 0.25)).toFixed(2);
        } else {
            const maxLossMult = Math.max(1.00, targetMult - 0.01);
            finalMultiplier = (1.00 + (Math.random() * (maxLossMult - 1.00))).toFixed(2);
        }

        const payout = isWin ? Math.floor(betAmount * targetMult) : 0;
        const netChange = isWin ? (payout - betAmount) : -betAmount;
        const newBalance = user.balance + netChange;

        await supabase.from('balances').update({ balance: newBalance }).eq('user_id', message.author.id);
        await processBet(user, betAmount, isWin);

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

    // 13. Coinflip Command (With Anti-Martingale & Global Win Overrides)
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

        let baseWinRate = 45.0; // 45% default win rate
        const customRate = await getGameWinRate('coinflip');
        if (customRate !== null && customRate !== undefined) {
            baseWinRate = customRate;
        }

        const finalWinRate = await evaluateMartingaleAndGetWinRate(user, betAmount, baseWinRate);
        const isWin = (Math.random() * 100) < finalWinRate;
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
        await processBet(user, betAmount, isWin);

        const embed = new EmbedBuilder()
            .setColor(isWin ? '#2ECC71' : '#E74C3C')
            .setTitle(`🪙 Coinflip Result: ${winningSide.toUpperCase()}`)
            .setDescription(isWin 
                ? `🎉 You guessed correctly and won **$${payout.toLocaleString()}**!` 
                : `💥 It landed on **${winningSide}**. You lost $${betAmount.toLocaleString()}.`)
            .addFields({ name: 'New Balance', value: `$${newBalance.toLocaleString()}` });

        return replyMsg.edit({ content: ' ', embeds: [embed] });
    }
});

// Interaction Handlers (Select Menus & Buttons)
client.on('interactionCreate', async (interaction) => {
    // Select Menu Interaction Handler for !win Control Panel
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'admin_select_game') {
            if (interaction.user.id !== process.env.ADMIN_DISCORD_ID) {
                return interaction.reply({ content: '❌ Admin access required.', ephemeral: true });
            }

            const selectedGame = interaction.values[0];
            const gameUpper = selectedGame.toUpperCase();

            const embed = new EmbedBuilder()
                .setColor('#3498DB')
                .setTitle(`⚙️ Setting Win Rate for ${gameUpper}`)
                .setDescription(`Step 2: Select desired win percentage for **${gameUpper}**:`);

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`set_rate_${selectedGame}`)
                    .setPlaceholder(`Step 2: Set Win Rate % for ${gameUpper}`)
                    .addOptions([
                        { label: 'Default Odds (Dynamic / Fair)', value: 'default', description: 'Reset to normal base win rate' },
                        { label: '0% (Always Lose)', value: '0', description: 'Force all players to lose' },
                        { label: '10% Win Rate', value: '10', description: 'Very low win chance' },
                        { label: '25% Win Rate', value: '25', description: 'Low win chance' },
                        { label: '50% Win Rate', value: '50', description: '50/50 win chance' },
                        { label: '75% Win Rate', value: '75', description: 'High win chance' },
                        { label: '100% (Always Win)', value: '100', description: 'Force all players to win' }
                    ])
            );

            return interaction.update({ embeds: [embed], components: [row] });
        }

        if (interaction.customId.startsWith('set_rate_')) {
            if (interaction.user.id !== process.env.ADMIN_DISCORD_ID) {
                return interaction.reply({ content: '❌ Admin access required.', ephemeral: true });
            }

            const gameName = interaction.customId.replace('set_rate_', '');
            const selectedVal = interaction.values[0];
            const rateValue = selectedVal === 'default' ? null : parseFloat(selectedVal);

            await supabase
                .from('game_settings')
                .upsert({ game_name: gameName, win_rate: rateValue });

            const displayMsg = rateValue === null 
                ? `✅ Reset **${gameName.toUpperCase()}** to default win rate!`
                : `✅ Updated **${gameName.toUpperCase()}** global win rate to **${rateValue}%**!`;

            return interaction.update({ content: displayMsg, embeds: [], components: [] });
        }
    }

    if (!interaction.isButton()) return;

    // Claim Referral Rewards Button
    if (interaction.customId.startsWith('claim_ref_')) {
        const targetUserId = interaction.customId.replace('claim_ref_', '');
        if (interaction.user.id !== targetUserId) {
            return interaction.reply({ content: '❌ You cannot claim someone else\'s referral rewards!', ephemeral: true });
        }

        const user = await getOrCreateUser(interaction.user.id, interaction.user.username);
        const pendingReward = user.unclaimed_ref_rewards || 0;

        if (pendingReward <= 0) {
            return interaction.reply({ content: '❌ You have no pending referral rewards to claim.', ephemeral: true });
        }

        const newBalance = user.balance + pendingReward;
        const totalEarnings = (user.total_ref_earnings || 0) + pendingReward;

        await supabase.from('balances').update({
            balance: newBalance,
            unclaimed_ref_rewards: 0,
            total_ref_earnings: totalEarnings
        }).eq('user_id', interaction.user.id);

        return interaction.reply({
            content: `🎉 Successfully claimed **$${pendingReward.toLocaleString()}** in referral rewards! Your new balance is **$${newBalance.toLocaleString()}**.`
        });
    }

    // Deposit Approval Button
    if (interaction.customId.startsWith('approve_')) {
        const [, depositId, userId, amount] = interaction.customId.split('_');
        const depositAmount = parseInt(amount);

        await supabase.from('deposits').update({ status: 'completed' }).eq('id', depositId);

        const user = await getOrCreateUser(userId, 'User');
        const newBalance = user.balance + depositAmount;
        const newWager = (user.wager_required || 0) + depositAmount;

        await supabase.from('balances').update({ balance: newBalance, wager_required: newWager }).eq('user_id', userId);

        if (depositAmount >= 15000000 && user.referred_by) {
            const referrerId = user.referred_by;

            const { data: refRecord } = await supabase
                .from('referrals')
                .select('*')
                .eq('referrer_id', referrerId)
                .eq('referred_id', userId)
                .single();

            if (refRecord && !refRecord.qualifying_deposit_done) {
                await supabase.from('referrals').update({ qualifying_deposit_done: true }).eq('id', refRecord.id);

                const { data: referrer } = await supabase.from('balances').select('*').eq('user_id', referrerId).single();
                if (referrer) {
                    const currentPending = referrer.unclaimed_ref_rewards || 0;
                    await supabase.from('balances').update({
                        unclaimed_ref_rewards: currentPending + 30000000
                    }).eq('user_id', referrerId);

                    try {
                        const referrerUser = await client.users.fetch(referrerId);
                        if (referrerUser) {
                            await referrerUser.send(`🎉 **Referral Bonus Earned!** Your referral <@${userId}> deposited **$${depositAmount.toLocaleString()}** (more than $15M)! You earned **$30,000,000**. Claim it using \`/ref\` or \`/refer\`.`);
                        }
                    } catch (err) { console.error(err); }
                }
            }
        }

        await interaction.update({
            content: `✅ **Accepted Deposit #${depositId}** for <@${userId}> ($${depositAmount.toLocaleString()}).`,
            embeds: [],
            components: []
        });
    }

    if (interaction.customId.startsWith('decline_')) {
        const [, depositId, userId] = interaction.customId.split('_');
        await supabase.from('deposits').update({ status: 'declined' }).eq('id', depositId);
        await interaction.update({ content: `❌ **Declined Deposit #${depositId}** for <@${userId}>.`, embeds: [], components: [] });
    }

    // Withdrawal Approval Buttons
    if (interaction.customId.startsWith('appwith_')) {
        const [, withId, userId, mcUsername, amount, channelId] = interaction.customId.split('_');
        const withAmount = parseInt(amount);

        await supabase.from('withdrawals').update({ status: 'completed' }).eq('id', withId);

        await interaction.update({
            content: `✅ **Accepted & Paid Withdrawal #${withId}** for <@${userId}> ($${withAmount.toLocaleString()}).`,
            embeds: [],
            components: []
        });

        try {
            const targetUser = await client.users.fetch(userId);
            await targetUser.send(`🎉 Your withdrawal of **$${withAmount.toLocaleString()}** to IGN \`${mcUsername}\` has been processed!`);
        } catch (err) { console.error(err); }

        try {
            const playChannel = await client.channels.fetch(channelId);
            if (playChannel) {
                await playChannel.send(`💸 User **<@${userId}>** received **$${withAmount.toLocaleString()}** withdrawal to IGN \`${mcUsername}\`!`);
            }
        } catch (err) { console.error(err); }
    }

    if (interaction.customId.startsWith('decwith_')) {
        const [, withId, userId, amount] = interaction.customId.split('_');
        const withAmount = parseInt(amount);

        await supabase.from('withdrawals').update({ status: 'declined' }).eq('id', withId);
        const user = await getOrCreateUser(userId, 'User');
        await supabase.from('balances').update({ balance: user.balance + withAmount }).eq('user_id', userId);

        await interaction.update({
            content: `❌ **Declined Withdrawal #${withId}**. Refunded **$${withAmount.toLocaleString()}** to <@${userId}>.`,
            embeds: [],
            components: []
        });
    }
});

console.log('Initiating connection to Discord...');
client.login(process.env.DISCORD_TOKEN).catch(err => console.error('❌ DISCORD LOGIN FAILED:', err.message));
