const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = {
  // Get user balance or create new user
  getOrCreateBalance: async (userId, username = 'Unknown') => {
    const { data, error } = await supabase
      .from('balances')
      .select('balance, mc_username')
      .eq('user_id', userId)
      .single();

    if (data) return { balance: parseInt(data.balance), mcUsername: data.mc_username };

    const { data: newData } = await supabase
      .from('balances')
      .insert({ user_id: userId, username: username })
      .select('balance, mc_username')
      .single();

    return { balance: parseInt(newData.balance), mcUsername: newData.mc_username };
  },

  // Save/Update Minecraft Username
  linkMcUsername: async (userId, mcUsername) => {
    await supabase
      .from('balances')
      .update({ mc_username: mcUsername })
      .eq('user_id', userId);
  },

  // Update User Balance
  updateBalance: async (userId, newAmount) => {
    const { data } = await supabase
      .from('balances')
      .update({ balance: newAmount })
      .eq('user_id', userId)
      .select('balance')
      .single();

    return parseInt(data.balance);
  }
};
