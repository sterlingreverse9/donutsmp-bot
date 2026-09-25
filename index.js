const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
            .insert([{ user_id: userId, username, balance: 0, claimed_starter: false }])
            .select()
            .single();
        return newUser;
    }
    return data;
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // !bal, $bal, /bal
    if (command === 'bal' || command === 'balance') {
        try {
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle(`💰 ${message.author.username}'s Profile`)
                .addFields(
                    { name: 'Balance', value: `$${user.balance.toLocaleString()}`, inline: true },
                    { name: 'MC IGN', value: user.mc_username || 'Not set', inline: true }
                );
            return message.reply({ embeds: [embed] });
        } catch (err) {
            return message.reply('❌ Error fetching balance.');
        }
    }

    // !start, $start, /start
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

    // !deposit, !depo, /depo, $deposit
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

    // !deposithistory, /deposithistory, $deposithistory
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
});

// Button Handlers
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // 1. User clicks "I Paid"
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

    // 2. Admin clicks "Accept"
    if (interaction.customId.startsWith('approve_')) {
        const [, depositId, userId, amount] = interaction.customId.split('_');
        const depositAmount = parseInt(amount);

        // Update deposit status
        await supabase.from('deposits').update({ status: 'completed' }).eq('id', depositId);

        // Fetch & update user balance
        const user = await getOrCreateUser(userId, 'User');
        const newBalance = user.balance + depositAmount;
        await supabase.from('balances').update({ balance: newBalance }).eq('user_id', userId);

        await interaction.update({
            content: `✅ **Accepted Deposit #${depositId}** for <@${userId}> ($${depositAmount.toLocaleString()}). Balance updated!`,
            embeds: [],
            components: []
        });

        // DM Depositor
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

    // 3. Admin clicks "Decline"
    if (interaction.customId.startsWith('decline_')) {
        const [, depositId, userId, amount] = interaction.customId.split('_');
        const depositAmount = parseInt(amount);

        // Update deposit status
        await supabase.from('deposits').update({ status: 'declined' }).eq('id', depositId);

        await interaction.update({
            content: `❌ **Declined Deposit #${depositId}** for <@${userId}> ($${depositAmount.toLocaleString()}).`,
            embeds: [],
            components: []
        });

        // DM Depositor
        try {
            const targetUser = await client.users.fetch(userId);
            const userEmbed = new EmbedBuilder()
                .setColor('#E74C3C')
                .setTitle('❌ Deposit Rejected')
                .setDescription(`Your deposit request of **$${depositAmount.toLocaleString()}** was rejected by the admin. Please contact support if you think this is an error.`);
            await targetUser.send({ embeds: [userEmbed] });
        } catch (err) {
            console.error('Could not DM user:', err);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
