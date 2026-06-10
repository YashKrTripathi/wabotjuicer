import express from 'express';
import dotenv from 'dotenv';
import http from 'http';
import { webhookRouter } from './whatsapp/webhook';
import { startOcppServer } from './ocpp/server';
import { startAll as startSimulators } from './simulator';
import { prisma } from './db/prisma';

dotenv.config();

const app = express();
app.use(express.json());

// WhatsApp Webhook endpoint
app.use('/webhook', webhookRouter);

// Health check / ping endpoint to keep Render awake
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
  try {
    // Check DB connection
    await prisma.$connect();
    console.log('Connected to Database');

    // Create a single HTTP server for both Express and OCPP WebSockets
    const server = http.createServer(app);

    // Start OCPP Server attached to the HTTP server
    await startOcppServer(server);

    // Start listening on a single port
    server.listen(PORT, () => {
      console.log(`Backend & OCPP Server listening on port ${PORT}`);
      // Launch internal simulators so they run in the cloud automatically
      startSimulators().catch(console.error);
    });

  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
