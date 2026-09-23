const express = require('express');
const bedrock = require('bedrock-protocol');

// 1. HTTP Server to keep Render Web Service health checks alive
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('DonutSMP Bot is running!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Web service listening on port ${PORT}`);
});

// 2. Bedrock Bot Client Setup
function startBot() {
  console.log('[BOT] Connecting to DonutSMP...');
  
  const client = bedrock.createClient({
    host: 'donutsmp.net',
    port: 19132,
    username: '.Fbfnch',
    offline: true,
    useNativeRaknet: false,
    connectTimeout: 30000
  });

  client.on('join', () => {
    console.log('[BOT] Connected and joined DonutSMP successfully!');
  });

  client.on('text', (packet) => {
    console.log(`[CHAT] ${packet.source_name || 'System'}: ${packet.message}`);
  });

  client.on('error', (err) => {
    console.error('[BOT ERROR]', err.message || err);
  });

  client.on('end', (reason) => {
    console.log('[BOT DISCONNECTED]', reason);
    console.log('[BOT] Reconnecting in 10 seconds...');
    setTimeout(startBot, 10000);
  });
}

startBot();
