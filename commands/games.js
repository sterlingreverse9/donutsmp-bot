// --- LIMBO GAME COMMAND ---
if (['limbo', 'lb'].includes(command)) {
    if (args.length < 2) {
        await message.reply(`❌ **Usage:** \`${prefix}limbo <amount> <target_multiplier>\`\n*Example:* \`${prefix}limbo 100 2.0\``);
        return true;
    }

    let betAmount = parseAmount(args[0]);
    let targetMulti = parseFloat(args[1].replace('x', ''));

    // Handle swapped inputs (e.g., if user types /limbo 100x 10)
    if (isNaN(betAmount) || betAmount <= 0) {
        betAmount = parseAmount(args[1]);
        targetMulti = parseFloat(args[0].replace('x', ''));
    }

    if (!betAmount || betAmount <= 0) {
        await message.reply('❌ **Invalid bet amount.**');
        return true;
    }

    if (isNaN(targetMulti) || targetMulti < 1.01 || targetMulti > 1000000) {
        await message.reply('❌ **Target multiplier must be between 1.01x and 1,000,000x.**');
        return true;
    }

    const user = await getOrCreateUser(message.author.id, message.author.username);
    if ((user.balance || 0) < betAmount) {
        await message.reply(`❌ **Insufficient balance!** You have **$${(user.balance || 0).toLocaleString()}**.`);
        return true;
    }

    // --- AUTHENTIC LIMBO MATHEMATICAL DISTRIBUTION ---
    // 1% House Edge (0.99 factor)
    // Generating standard random float (0.0000001 to 0.9999999)
    const randomFloat = Math.random();
    
    // Exact standard casino formula: Multiplier scales exponentially.
    // Low rolls (1.0x - 3.0x) happen ~70% of the time.
    // High rolls (80x+) happen less than 1% of the time.
    let rolledMulti = parseFloat((0.99 / (1 - randomFloat)).toFixed(2));
    
    // Hard floor at 1.00x
    if (rolledMulti < 1.00) rolledMulti = 1.00;

    // Check Win/Loss based on independent roll
    const isWin = rolledMulti >= targetMulti;

    let newBalance = user.balance;
    let newWager = Math.max(0, (user.wager_required || 0) - betAmount);
    let profit = 0;

    if (isWin) {
        profit = Math.floor(betAmount * (targetMulti - 1));
        newBalance += profit;
    } else {
        newBalance -= betAmount;
    }

    // Update Database
    await supabase.from('balances').upsert({
        user_id: message.author.id,
        username: message.author.username,
        balance: newBalance,
        wager_required: newWager
    }, { onConflict: 'user_id' });

    // Build Response Embed
    const embed = new EmbedBuilder()
        .setTitle(isWin ? '🚀 Limbo — WINNER!' : '💥 Limbo — CRASHED!')
        .setColor(isWin ? '#00FF00' : '#FF0000')
        .addFields(
            { name: 'Target Multiplier', value: `\`${targetMulti.toFixed(2)}x\``, inline: true },
            { name: 'Rolled Multiplier', value: `\`${rolledMulti.toFixed(2)}x\``, inline: true },
            { name: 'Bet Amount', value: `\`$${betAmount.toLocaleString()}\``, inline: true },
            { name: isWin ? 'Profit' : 'Loss', value: isWin ? `\`+$${profit.toLocaleString()}\`` : `\`-$${betAmount.toLocaleString()}\``, inline: true },
            { name: 'New Balance', value: `\`$${newBalance.toLocaleString()}\``, inline: true }
        )
        .setFooter({ text: 'Donut Bet Bot' })
        .setTimestamp();

    await message.reply({ embeds: [embed] });
    return true;
}
