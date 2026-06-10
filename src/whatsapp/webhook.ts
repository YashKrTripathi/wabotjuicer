import { Router, Request, Response } from 'express';
import { handleIncomingMessage } from './bot';

export const webhookRouter = Router();

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'ebeecharge_demo';

// Webhook Verification
webhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Incoming Messages
webhookRouter.post('/', async (req: Request, res: Response) => {
  const body = req.body;

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0] &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const phoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from;
      
      let msgBody = '';
      if (message.type === 'text') {
        msgBody = message.text.body;
      } else if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
        msgBody = message.interactive.button_reply.title;
      } else {
        // Fallback or ignore
        res.sendStatus(200);
        return;
      }

      console.log(`Received WhatsApp message from ${from}: ${msgBody}`);

      // Handle message asynchronously to immediately return 200 OK to WhatsApp
      handleIncomingMessage(from, msgBody).catch(err => {
        console.error('Error handling incoming message:', err);
      });
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});
