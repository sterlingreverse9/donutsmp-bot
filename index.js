const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const db = require('./database');

// Health-check server for Render
const app = express();
app.get('/', (req, res) => res.send('Donut Bet Bot is active!'));
app.listen(process.env.PORT || 10000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const ADMIN_ID = process.env.ADMIN_DISCORD_ID; // Your Discord ID

client.on('ready', () => console.log(`[BOT] Logged in as ${client.user.tag}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args[0].toLowerCase();
  const userId = message.author.id;
  const username = message.author.username;

  // -------------------------------------------------------------
  // 1. CHECK BALANCE (!bal)
  // -------------------------------------------------------------
  if (command === '!bal') {
    try {
      const user = await db.getOrCreateBalance(userId, username);
      const ign = user.mcUsername ? `\`${user.mcUsername}\`` : '*Not set yet*';
      
      return message.reply(`💰 **${username}**\n• Balance: **${user.balance.toLocaleString()}** Chips\n• Linked MC IGN: ${ign}`);
    } catch (err) {
      return message.reply('❌ Error fetching balance.');
    }
  }

  // -------------------------------------------------------------
  // 2. USER DEPOSIT REQUEST (!deposit <Minecraft_IGN> <Amount>)
  // -------------------------------------------------------------
  if (command === '!deposit') {
    const mcUsername = args[1];
    const amount = parseInt(args[2]);

    if (!mcUsername || isNaN(amount) || amount <= 0) {
      return message.reply('❌ **Usage:** `!deposit <Minecraft_IGN> <Amount>`\n*Example:* `!deposit Player123 500000`');
    }

    try {
      // Save/Update their Minecraft username in the database
      await db.getOrCreateBalance(userId, username);
      await db.linkMcUsername(userId, mcUsername);

      const embed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('📥 Deposit Request Submitted')
        .setDescription(`Deposit request received! Send **$${amount.toLocaleString()}** in-game from IGN **\`${mcUsername}\`**.`)
        .addFields(
          { name: 'Discord User', value: `<@${userId}>`, inline: true },
          { name: 'Minecraft IGN Sending Money', value: `\`${mcUsername}\``, inline: true },
          { name: 'Amount', value: `**$${amount.toLocaleString()}**`, inline: true }
        )
        .setFooter({ text: 'An admin will confirm after receiving the money in-game.' });

      return message.reply({ embeds: [embed] });
    } catch (err) {
      return message.reply('❌ Failed to process deposit request.');
    }
  }

  // -------------------------------------------------------------
  // 3. ADMIN CONFIRM DEPOSIT (!confirm @user <Amount>)
  // -------------------------------------------------------------
  if (command === '!confirm') {
    if (userId !== ADMIN_ID) return message.reply('❌ Only the bot admin can confirm deposits.');

    const targetUser = message.mentions.users.first();
    const amount = parseInt(args[2]);

    if (!targetUser || isNaN(amount) || amount <= 0) {
      return message.reply('❌ **Usage:** `!confirm @user <Amount>`');
    }

    try {
      const targetData = await db.getOrCreateBalance(targetUser.id, targetUser.username);
      const newBalance = targetData.balance + amount;
      await db.updateBalance(targetUser.id, newBalance);

      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('✅ Deposit Confirmed!')
        .setDescription(`Successfully added **${amount.toLocaleString()}** chips to ${targetUser}!`)
        .addFields(
          { name: 'Minecraft Account', value: targetData.mcUsername ? `\`${targetData.mcUsername}\`` : 'Unknown', inline: true },
          { name: 'New Balance', value: `**${newBalance.toLocaleString()}** Chips`, inline: true }
        );

      return message.reply({ embeds: [embed] });
    } catch (err) {
      return message.reply('❌ Error confirming deposit.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
