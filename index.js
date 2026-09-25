const express = require('express');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// 1. HTTP Server for Render Port Health Check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Donut Bet Bot is live!');
});

app.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// 2. Discord Bot & Supabase Setup
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

// Helper to parse values like 500k, 5m, 1.5b
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

// Database Helpers
async function getOrCreateUser(userId, username) {
    let { data, error } = await supabase
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

    // Determine prefix used
    const prefix = ALLOWED_PREFIXES.find(p => message.content.startsWith(p));
    if (!prefix) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command: !bal, $bal, /bal
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

    // Command: !start, $start, /start
    if (command === 'start') {
        try {
            let user = await getOrCreateUser(message.author.id, message.author.username);

            if (!user.claimed_starter) {
                // Give 1M starter balance
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

    // Command: !deposit, !depo, /depo, $deposit
    if (command === 'deposit' || command === 'depo') {
        const mcUsername = args[0];
        const rawAmount = args[1];
        const amount = parseAmount(rawAmount);

        if (!mcUsername || !amount || amount <= 0) {
            return message.reply(`❌ **Usage:** \`${prefix}${command} <MC_IGN> <Amount>\` (e.g. \`${prefix}${command} Player123 500k\`)`);
        }

        // Save pending deposit in DB
        const { data: depRecord } = await supabase
            .from('deposits')
            .insert([{ user_id: message.author.id, mc_username: mcUsername, amount, status: 'pending' }])
            .select()
            .single();

        const depositId = depRecord ? depRecord.id : 'N/A';

        // Simplified Embed
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
                .setCustomId(`paid_${depositId}_${mcUsername}_${amount}`)
                .setLabel('I Paid')
                .setStyle(ButtonStyle.Success)
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // Command: !deposithistory, /deposithistory, $deposithistory
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

// Handle "I Paid" Button Click & Admin Notification
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('paid_')) {
        const [, depositId, mcUsername, amount] = interaction.customId.split('_');

        await interaction.reply({ content: '✅ Payment confirmation sent to Admin!', ephemeral: true });

        // Notify Admin via DM
        const adminId = process.env.ADMIN_DISCORD_ID;
        if (adminId) {
            try {
                const adminUser = await client.users.fetch(adminId);
                const adminEmbed = new EmbedBuilder()
                    .setColor('#F39C12')
                    .setTitle('🔔 New Deposit Alert!')
                    .addFields(
                        { name: 'User', value: `<@${interaction.user.id}> (${interaction.user.username})` },
                        { name: 'MC IGN', value: `\`${mcUsername}\``, inline: true },
                        { name: 'Amount', value: `$${parseInt(amount).toLocaleString()}`, inline: true },
                        { name: 'Deposit ID', value: `#${depositId}`, inline: true }
                    )
                    .setTimestamp();

                await adminUser.send({ embeds: [adminEmbed] });
            } catch (err) {
                console.error('Failed to DM Admin:', err);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
