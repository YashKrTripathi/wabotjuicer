import { handleIncomingMessage } from './src/whatsapp/bot';

async function main() {
  await handleIncomingMessage('1234567890', 'UP65DJ7053');
}
main();
