import axios from 'axios';
import { prisma } from '../db/prisma';
import { requestRemoteStart, requestRemoteStop } from '../ocpp/server';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

export async function sendWhatsAppMessage(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn(`[WhatsApp API Not Configured] To: ${to} | Message: ${text}`);
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    // Log outbound message
    await prisma.whatsappMessage.create({
      data: {
        phone: to,
        direction: 'OUTBOUND',
        content: text,
      }
    });
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
  }
}

export async function sendWhatsAppInteractiveButtons(to: string, text: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.warn(`[WhatsApp API Not Configured] To: ${to} | Message: ${text}`);
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: text
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: { id: 'CMD_STATUS', title: 'STATUS' }
              },
              {
                type: 'reply',
                reply: { id: 'CMD_STOP', title: 'STOP' }
              }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    await prisma.whatsappMessage.create({
      data: {
        phone: to,
        direction: 'OUTBOUND',
        content: `[Buttons] ${text}`,
      }
    });
  } catch (error: any) {
    console.error('Error sending WhatsApp interactive message:', error.response?.data || error.message);
  }
}

export async function handleIncomingMessage(from: string, text: string) {
  // Log inbound message
  await prisma.whatsappMessage.create({
    data: {
      phone: from,
      direction: 'INBOUND',
      content: text,
    }
  });

  const command = text.trim().toUpperCase();

  // Find or create customer
  let customer = await prisma.customer.findUnique({ where: { phone: from } });
  if (!customer) {
    customer = await prisma.customer.create({ data: { phone: from } });
  }

  // State Machine logic
  if (command === 'START') {
    await sendWhatsAppMessage(from, 'Welcome to EbeeCharge! ⚡️\nPlease reply with your vehicle number to begin.');
    return;
  }

  if (command === 'STATUS') {
    // Find active charging request
    const request = await prisma.chargingRequest.findFirst({
      where: { customer_id: customer.id, status: 'STARTED' },
      orderBy: { created_at: 'desc' },
      include: {
        session: {
          include: {
            meterValues: {
              orderBy: { timestamp: 'desc' },
              take: 2,
            }
          }
        }
      }
    });

    if (!request || !request.session) {
      await sendWhatsAppMessage(from, 'No active charging session found.');
      return;
    }

    const session = request.session;
    let power = 0;
    let energyDelivered = 0;
    const durationMs = new Date().getTime() - session.created_at.getTime();
    const durationMins = Math.floor(durationMs / 60000);

    if (session.meterValues && session.meterValues.length > 0) {
      const latest = session.meterValues[0]!.value;
      energyDelivered = latest - session.meter_start;
      
      // Calculate power if we have at least 2 meter values
      if (session.meterValues.length > 1) {
        const previous = session.meterValues[1]!.value;
        const timeDiffHr = (session.meterValues[0]!.timestamp.getTime() - session.meterValues[1]!.timestamp.getTime()) / 3600000;
        if (timeDiffHr > 0) {
          power = (latest - previous) / timeDiffHr; // kW
        }
      }
    }

    const reply = `*Status:* ${session.status}\n*Energy Delivered:* ${energyDelivered.toFixed(2)} kWh\n*Power:* ${power.toFixed(2)} kW\n*Duration:* ${durationMins} mins`;
    await sendWhatsAppInteractiveButtons(from, reply);
    return;
  }

  if (command === 'STOP') {
    // Find active session
    const request = await prisma.chargingRequest.findFirst({
      where: { customer_id: customer.id, status: 'STARTED' },
      orderBy: { created_at: 'desc' },
      include: { session: true }
    });

    if (!request || !request.session || !request.session.transaction_id) {
      await sendWhatsAppMessage(from, 'No active charging session to stop.');
      return;
    }

    const success = await requestRemoteStop(request.session.charger_id, request.session.transaction_id);
    if (success) {
      await sendWhatsAppMessage(from, 'Charging stopped successfully. Have a safe trip! 🚗💨');
    } else {
      await sendWhatsAppMessage(from, 'We couldn\'t stop the charging session. Please contact support.');
    }
    return;
  }

  // If none of the above, check if the customer was asked for a vehicle number recently
  // START flow
  if (command.toUpperCase().startsWith('START')) {
    // Check if it's a specific charger scan (e.g., START CHARGER_001)
    const match = command.toUpperCase().match(/^START\s+(CHARGER_\d+)/);
    
    if (match) {
      const chargerIdStr = match[1];
      const charger = await prisma.charger.findUnique({ where: { identity: chargerIdStr } });
      
      if (!charger) {
        await sendWhatsAppMessage(from, `Charger ${chargerIdStr} not found.`);
        return;
      }
      
      if (charger.status !== 'AVAILABLE') {
        await sendWhatsAppMessage(from, `Charger ${chargerIdStr} is currently ${charger.status.toLowerCase()}. Please try again later or select another slot.`);
        return;
      }

      // Create a pending request with the pre-selected charger
      await prisma.chargingRequest.create({
        data: {
          customer_id: customer.id,
          vehicle_number: '',
          status: 'PENDING',
          charger_id: charger.id
        }
      });

      await sendWhatsAppMessage(from, `Welcome to EbeeCharge! ⚡️\n\nYou've selected Slot: ${charger.identity}.\nPlease reply with your vehicle number to begin.`);
      return;
    }

    // Default START command
    await prisma.chargingRequest.create({
      data: {
        customer_id: customer.id,
        vehicle_number: '',
        status: 'PENDING'
      }
    });

    await sendWhatsAppMessage(from, 'Welcome to EbeeCharge! ⚡️\nPlease reply with your vehicle number to begin.');
    return;
  }

  // Handle vehicle number step
  const pendingVehicleRequest = await prisma.chargingRequest.findFirst({
    where: { customer_id: customer.id, status: 'PENDING' },
    orderBy: { created_at: 'desc' }
  });

  if (pendingVehicleRequest) {
    const vehicleNumber = command;

    let chargerId = pendingVehicleRequest.charger_id;
    let chargerToAssign = null;

    if (chargerId) {
      // They scanned a QR code, use the pre-selected charger
      chargerToAssign = await prisma.charger.findUnique({ where: { id: chargerId } });
      if (chargerToAssign && chargerToAssign.status !== 'AVAILABLE') {
        await sendWhatsAppMessage(from, `Sorry, ${chargerToAssign.identity} was just taken! Please scan another slot.`);
        await prisma.chargingRequest.update({ where: { id: pendingVehicleRequest.id }, data: { status: 'FAILED' } });
        return;
      }
    } else {
      // They just sent START, find any available charger
      chargerToAssign = await prisma.charger.findFirst({
        where: { status: 'AVAILABLE' }
      });
      if (!chargerToAssign) {
        await sendWhatsAppMessage(from, 'No chargers are currently available. Please try again later.');
        await prisma.chargingRequest.update({ where: { id: pendingVehicleRequest.id }, data: { status: 'FAILED' } });
        return;
      }
      chargerId = chargerToAssign.id;
    }

    // Assign and update status
    await prisma.chargingRequest.update({
      where: { id: pendingVehicleRequest.id },
      data: { 
        vehicle_number: vehicleNumber, 
        status: 'PAYMENT_PENDING',
        charger_id: chargerId
      }
    });

    await sendWhatsAppMessage(from, `Charger ${chargerToAssign!.identity} (16A) has been assigned to you! 🔌\n\nPlease enter the amount you wish to pay in ₹.\n\n*(Rate: ₹10/kWh. Example: A full 40kWh charge costs ₹400, or a two-wheeler 4kWh charge costs ₹40)*`);
    return;
  }

  // Handle Dynamic Payment Step
  const pendingRequest = await prisma.chargingRequest.findFirst({
    where: { customer_id: customer.id, status: 'PAYMENT_PENDING' },
    orderBy: { created_at: 'desc' }
  });

  if (pendingRequest && pendingRequest.charger_id) {
    const amount = parseFloat(command);
    if (isNaN(amount) || amount <= 0) {
      // If it's not a number, we just fallback or prompt again
      if (command !== 'STATUS' && command !== 'STOP') {
        await sendWhatsAppMessage(from, 'Please enter a valid payment amount in ₹ (e.g. 200).');
        return;
      }
    } else {
      let energyLimit = amount / 10;
      if (energyLimit > 40) energyLimit = 40; // Cap at 40 kWh

      await prisma.chargingRequest.update({
        where: { id: pendingRequest.id },
        data: { amount_paid: amount, energy_limit: energyLimit }
      });

      // Try starting a session remotely
      const success = await requestRemoteStart(pendingRequest.charger_id, pendingRequest.id);
      if (success) {
        await prisma.chargingRequest.update({
          where: { id: pendingRequest.id },
          data: { status: 'STARTED' }
        });
        await sendWhatsAppInteractiveButtons(from, `Payment of ₹${amount} successful! ✅ Target set to ${energyLimit.toFixed(1)} kWh. Charging Started.`);
      } else {
        await prisma.chargingRequest.update({
          where: { id: pendingRequest.id },
          data: { status: 'FAILED' }
        });
        await sendWhatsAppMessage(from, `Payment successful, but we couldn't connect to the charger. Please try again or contact support.`);
      }
      return;
    }
  }

  await sendWhatsAppMessage(from, 'Send START to begin charging, STATUS to view live data, or STOP to stop charging.');
}
