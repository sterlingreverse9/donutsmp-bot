const supabase = require('../config/supabase');
const { getOrCreateUser } = require('../utils/helpers');
const { EmbedBuilder } = require('discord.js');

async function handleGeneralCommands(command, args, message, prefix) {
    console.log(`[GENERAL HANDLER ENTERED] Executing: "${command}" for user ${message.author.tag}`);

    try {
        // --- 1. BALANCE / PROFILE COMMAND ---
        if (['bal', 'balance', 'b', 'profile'].includes(command)) {
            console.log(`[BAL COMMAND] Fetching/creating user record...`);
            const user = await getOrCreateUser(message.author.id, message.author.username);

            const embed = new EmbedBuilder()
                .setColor('#F1C40F')
                .setTitle(`💰 ${message.author.username}'s Profile`)
                .addFields(
                    { name: 'Balance', value: `$${(user?.balance || 0).toLocaleString()}`, inline: true },
                    { name: 'Linked IGN', value: user?.mc_username ? `\`${user.mc_username}\`` : 'None (`!link <IGN>`)', inline: true },
                    { name: 'Rakeback', value: `$${(user?.rakeback || 0).toLocaleString()}`, inline: true },
                    { name: 'Wager Left', value: `$${(user?.wager_required || 0).toLocaleString()}`, inline: true }
                );

            await message.reply({ embeds: [embed] });
            console.log(`[BAL COMMAND] Reply sent successfully.`);
            return true;
        }

        // --- 2. REFERRAL DASHBOARD COMMAND ---
        if (['ref', 'refer', 'referral'].includes(command)) {
            console.log(`[REF COMMAND] Querying referrals for ${message.author.id}...`);
            
            const { data: refList, error } = await supabase
                .from('balances')
                .select('*')
                .eq('referred_by', message.author.id);

            if (error) {
                console.error('❌ Supabase error in !ref query:', error);
            }

            const totalRefs = refList ? refList.length : 0;
            const refNames = refList && refList.length > 0
                ? refList.map((r, idx) => `${idx + 1}. **${r.username \vert{}\vert{} 'User'}** (${r.ref_reward_claimed ? '✅ Qualified' : '⏳ Pending'})`).join('\n')
                : 'No referred users yet.';

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('🤝 Referral Dashboard')
                .setDescription('Invite friends to earn massive rewards!')
                .addFields(
                    { name: '🎁 Reward Details', value: '• Friend deposits **$1,000,000** total\n• You receive **$5,000,000** + **2% of their lifetime losses**!' },
                    { name: '🔗 Your Referral ID', value: `\`${message.author.id}\``, inline: true },
                    { name: '📲 Link Command', value: `\`${prefix}linkref ${message.author.id}\``, inline: true },
                    { name: `Referred Users (${totalRefs})`, value: refNames, inline: false }
                )
                .setFooter({ text: 'Donut SMP Bot' });

            await message.reply({ embeds: [embed] });
            console.log(`[REF COMMAND] Reply sent successfully.`);
            return true;
        }

        // --- 3. LINK REFERRER COMMAND ---
        if (command === 'linkref') {
            console.log(`[LINKREF COMMAND] Processing link for ${message.author.id}...`);
            const user = await getOrCreateUser(message.author.id, message.author.username);
            const referrerId = args[0];

            if (!referrerId) {
                await message.reply(`❌ **Usage:** \`${prefix}linkref <referrer_user_id>\``);
                return true;
            }
            if (referrerId === message.author.id) {
                await message.reply('❌ You cannot refer yourself!');
                return true;
            }
            if (user?.referred_by) {
                await message.reply('❌ You have already linked a referrer.');
                return true;
            }

            const { data: referrer, error } = await supabase
                .from('balances')
                .select('*')
                .eq('user_id', referrerId)
                .single();

            if (error || !referrer) {
                console.error('❌ Supabase error finding referrer:', error);
                await message.reply('❌ Invalid referrer User ID.');
                return true;
            }

            await supabase
                .from('balances')
                .update({ referred_by: referrerId })
                .eq('user_id', message.author.id);

            await message.reply(`✅ Successfully linked **${referrer.username || referrer.user_id}** as your referrer!`);
            return true;
        }

        // --- 4. LINK MINECRAFT IGN COMMAND ---
        if (command === 'link') {
            console.log(`[LINK COMMAND] Processing IGN link for ${message.author.id}...`);
            const mcUsername = args[0];

            if (!mcUsername) {
                await message.reply(`❌ **Usage:** \`${prefix}link <MC_IGN>\``);
                return true;
            }

            const { error } = await supabase
                .from('balances')
                .update({ mc_username: mcUsername })
                .eq('user_id', message.author.id);

            if (error) {
                console.error('❌ Supabase error updating IGN:', error);
                await message.reply('❌ Database error while linking IGN.');
                return true;
            }

            await message.reply(`✅ Successfully linked Minecraft IGN **\`${mcUsername}\`**!`);
            return true;
        }

        // If command doesn't match any of these
        return false;

    } catch (err) {
        console.error(`❌ CRITICAL EXCEPTION inside handleGeneralCommands for "${command}":`, err);
        await message.reply('❌ An internal error occurred while processing this command. Check Render logs.').catch(() => {});
        return true; // Return true so index.js knows the command was caught here
    }
}

module.exports = { handleGeneralCommands };
