const bedrock = require('bedrock-protocol');

const client = bedrock.createClient({
  host: 'donutsmp.net',
  port: 19132,
  username: '.Fbfnch',
  offline: true,
  useNativeRaknet: false
});

client.on('join', () => {
  console.log('[BOT] Successfully connected and joined DonutSMP!');
});

client.on('text', (packet) => {
  console.log(`[CHAT] ${packet.source_name || 'System'}: ${packet.message}`);
});

client.on('error', (err) => {
  console.error('[ERROR]', err);
});

client.on('end', (reason) => {
  console.log('[DISCONNECTED]', reason);
});
