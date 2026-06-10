# EbeeCharge WhatsApp OCPP MVP Backend

This is an MVP backend for EbeeCharge that connects a WhatsApp Chatbot to an OCPP Charging server. It provides a seamless EV charging experience, allowing customers to start, monitor, and stop their charging sessions directly from WhatsApp.

## Prerequisites

- **Node.js**: `v18+`
- **Database**: PostgreSQL
- **Meta/WhatsApp Cloud API Setup**: You will need your tokens, a registered phone number, and a webhook configuration.

## Setup Instructions

1. **Install Dependencies**
   ```bash
   cd ebee-wa-bot
   npm install
   ```

2. **Environment Setup**
   Copy the example environment file and fill in your details:
   ```bash
   cp .env.example .env
   ```
   **Key Variables:**
   - `DATABASE_URL`: Your PostgreSQL connection string.
   - `WHATSAPP_TOKEN`: Your temporary or permanent WhatsApp Cloud API token.
   - `WHATSAPP_PHONE_NUMBER_ID`: The Phone Number ID provided by Meta.
   - `WHATSAPP_VERIFY_TOKEN`: A custom string for webhook verification (e.g., `ebeecharge_demo`).

3. **Database Migration & Seeding**
   Ensure your database is running, then run Prisma commands to setup the schema and seed mock chargers:
   ```bash
   npx prisma db push
   npm run seed
   ```

4. **Start the Backend**
   ```bash
   npm run dev
   ```
   *The server will start listening for Webhooks on port `3000` and for OCPP connections on port `3001`.*

## Setting Up Webhooks with ngrok

Since the WhatsApp Cloud API requires a public HTTPS endpoint, you can use `ngrok` to expose your local server.

1. **Start ngrok**
   ```bash
   ngrok http 3000
   ```
2. Copy the forwarding URL (e.g., `https://<your-id>.ngrok.io`).
3. **Configure Meta Developer Portal**:
   - Go to your App Dashboard -> WhatsApp -> Configuration.
   - Set the **Callback URL** to `https://<your-id>.ngrok.io/webhook`.
   - Set the **Verify Token** to the exact value of your `WHATSAPP_VERIFY_TOKEN` in `.env`.
   - Subscribe to the `messages` webhook field.

## Testing with Charger Simulator

1. Go to the provided `ocpp-rpc-master/demo` folder.
2. We need to connect a simulator to our backend. The backend is expecting one of the seeded identities: `CHARGER_001`, `CHARGER_002`, or `CHARGER_003`.
3. Modify the demo simulator (or pass it via CLI/env if supported) to use `CHARGER_001` and connect to `ws://localhost:3001`.
   *Example start command assuming the demo client supports arguments:*
   ```bash
   node combined-cli.js ws://localhost:3001 CHARGER_001
   ```
   *(Check the demo client's code to adjust the `CHARGER_ID` and `PORT` / `HOST` appropriately to point to `localhost:3001`)*

## WhatsApp Flow Testing

Once the charger is connected and logging heartbeat/boot notifications:

1. **Start Session**: 
   - Send `START` to your WhatsApp Bot.
   - Reply with your vehicle number (e.g., `MH12AB1234`).
   - The bot will assign an available charger and issue a `RemoteStartTransaction`.
2. **Monitor Session**: 
   - Wait a moment for the simulator to send `MeterValues`.
   - Send `STATUS` to see Energy Delivered, Power, and Duration.
3. **Stop Session**: 
   - Send `STOP` to trigger a `RemoteStopTransaction`.
   - The simulator will stop charging and the bot will confirm.
