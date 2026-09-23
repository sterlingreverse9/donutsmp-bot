const express = require('express');
const bedrock = require('bedrock-protocol');

// 1. HTTP Server to satisfy Render Web Service health checks
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('DonutSMP Gambling Bot service is live!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Web server running on port ${PORT}`);
});

// 2. Bedrock Client Connection Logic
function connectBot() {
  console.log('[BOT] Connecting to DonutSMP...');

  const client = bedrock.createClient({
    host: 'donutsmp.net',
    port: 19132,
    username: '.Fbfnch',
    offline: true,
    skipPing: true, // Skips RakNet discovery ping to avoid promise rejection on Render
    useNativeRaknet: false,
    connectTimeout: 45000
  });

  client.on('join', () => {
    console.log('[BOT] Successfully joined DonutSMP!');
  });

  client.on('text', (packet) => {
    const sender = packet.source_name || 'System';
    const message = packet.message || '';
    console.log(`[CHAT] ${sender}: ${message}`);
  });

  client.on('error', (err) => {
    console.error('[BOT ERROR]', err.message || err);
  });

  client.on('end', (reason) => {
    console.log('[BOT DISCONNECTED]', reason);
    console.log('[BOT] Reconnecting in 10 seconds...');
    setTimeout(connectBot, 10000);
  });
}

connectBot();
