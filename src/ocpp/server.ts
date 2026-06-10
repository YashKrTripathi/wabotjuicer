import { RPCServer, createRPCError } from 'ocpp-rpc';
import { prisma } from '../db/prisma';

// Keep track of active clients by charger database ID
const activeClients = new Map<number, any>();

let server: any;

export async function startOcppServer(httpServer: any) {
  server = new RPCServer({
    wssOptions: { server: httpServer },
    protocols: ['ocpp1.6'],
    strictMode: false,
    callConcurrency: 4,
  });

  server.auth(async (accept: any, reject: any, handshake: any) => {
    const identity = handshake.identity;
    const charger = await prisma.charger.findUnique({ where: { identity } });
    if (!charger) {
      console.log(`[OCPP] Rejected charger ${identity}`);
      reject(401, 'Unknown charger');
      return;
    }
    console.log(`[OCPP] Accepted charger ${identity}`);
    
    // Pass charger info to accept
    accept({ chargerId: charger.id, identity: charger.identity });
  });

  server.on('client', async (client: any) => {
    const sessionInfo = client.session; // the object passed in accept()
    activeClients.set(sessionInfo.chargerId, client);
    console.log(`[OCPP] Charger connected: ${sessionInfo.identity}`);

    // Bind Handlers synchronously
    client.handle('BootNotification', async ({ params }: any) => {
      await prisma.charger.update({
        where: { id: sessionInfo.chargerId },
        data: { vendor: params.chargePointVendor, model: params.chargePointModel }
      });
      return { status: 'Accepted', currentTime: new Date().toISOString(), interval: 30 };
    });

    client.handle('Heartbeat', ({ params }: any) => {
      return { currentTime: new Date().toISOString() };
    });

    client.handle('StatusNotification', async ({ params }: any) => {
      await prisma.charger.update({
        where: { id: sessionInfo.chargerId },
        data: { status: params.status.toUpperCase() }
      });
      return {};
    });

    client.handle('StartTransaction', async ({ params }: any) => {
      const request = await prisma.chargingRequest.findFirst({
        where: { id: parseInt(params.idTag), status: 'STARTED' },
      });

      let sessionId = -1;
      const tId = Math.floor(Math.random() * 1000000);
      
      const newSession = await prisma.chargingSession.create({
        data: {
          request_id: request ? request.id : -1,
          charger_id: sessionInfo.chargerId,
          transaction_id: tId,
          status: 'STARTED',
          meter_start: params.meterStart / 1000,
        }
      });

      return {
        transactionId: tId,
        idTagInfo: { status: 'Accepted' },
      };
    });

    client.handle('MeterValues', async ({ params }: any) => {
      const transactionId = params.transactionId;
      const session = await prisma.chargingSession.findUnique({
        where: { transaction_id: transactionId },
        include: { request: true }
      });

      if (session) {
        let currentMeterValue = 0;
        for (const mv of params.meterValue) {
          const sampledValue = mv.sampledValue?.[0];
          if (sampledValue) {
            const val = parseFloat(sampledValue.value) / 1000;
            currentMeterValue = val;
            await prisma.meterValue.create({
              data: {
                session_id: session.id,
                value: val,
                timestamp: mv.timestamp ? new Date(mv.timestamp) : new Date()
              }
            });
          }
        }

        // Auto-stop if limit reached
        if (session.request && session.request.energy_limit) {
           const energyDelivered = currentMeterValue - session.meter_start;
           if (energyDelivered >= session.request.energy_limit) {
               console.log(`[OCPP] Energy limit reached for transaction ${transactionId}, triggering RemoteStop`);
               requestRemoteStop(session.charger_id, transactionId);
               
               // Notify user
               if (session.request.customer_id) {
                   const customer = await prisma.customer.findUnique({ where: { id: session.request.customer_id } });
                   if (customer) {
                       const { sendWhatsAppMessage } = await import('../whatsapp/bot');
                       await sendWhatsAppMessage(customer.phone, 'Your charging target has been reached! Session stopped automatically. Have a safe trip! 🚗💨');
                   }
               }
           }
        }
      }
      return {};
    });

    client.handle('StopTransaction', async ({ params }: any) => {
      const transactionId = params.transactionId;
      
      const session = await prisma.chargingSession.findUnique({
        where: { transaction_id: transactionId }
      });

      if (session) {
        await prisma.chargingSession.update({
          where: { id: session.id },
          data: {
            status: 'STOPPED',
            meter_stop: params.meterStop / 1000,
          }
        });
        
        if (session.request_id) {
          await prisma.chargingRequest.update({
            where: { id: session.request_id },
            data: { status: 'COMPLETED' }
          });
        }
      }
      
      return { idTagInfo: { status: 'Accepted' } };
    });



    // Logging all messages
    client.on('message', async (event: any) => {
      await prisma.ocppMessage.create({
        data: {
          charger_id: sessionInfo.chargerId,
          direction: event.outbound ? 'OUTBOUND' : 'INBOUND',
          action: event.action || 'Unknown',
          payload: event.payload || {},
        }
      });
    });



    client.on('close', async () => {
      console.log(`[OCPP] Charger disconnected: ${sessionInfo.identity}`);
      activeClients.delete(sessionInfo.chargerId);
      await prisma.charger.update({
        where: { id: sessionInfo.chargerId },
        data: { status: 'UNAVAILABLE' }
      });
    });
  });

  console.log(`[OCPP] Server attached to HTTP server.`);
}

export async function requestRemoteStart(chargerId: number, requestId: number): Promise<boolean> {
  console.log(`[OCPP] requestRemoteStart called for chargerId: ${chargerId}`);
  console.log(`[OCPP] activeClients keys:`, Array.from(activeClients.keys()));
  
  const client = activeClients.get(chargerId);
  if (!client) {
    console.log(`[OCPP] Client not found for chargerId: ${chargerId}`);
    return false;
  }

  try {
    const response = await client.call('RemoteStartTransaction', {
      connectorId: 1,
      idTag: requestId.toString(), // Pass the request ID as idTag
    });
    console.log('[OCPP] RemoteStartTransaction sent:', response);
    return response.status === 'Accepted';
  } catch (error) {
    console.error('RemoteStartTransaction Error:', error);
    return false;
  }
}

export async function requestRemoteStop(chargerId: number, transactionId: number): Promise<boolean> {
  const client = activeClients.get(chargerId);
  if (!client) {
    return false;
  }

  try {
    const response = await client.call('RemoteStopTransaction', {
      transactionId: transactionId,
    });
    console.log('[OCPP] RemoteStopTransaction sent:', response);
    return response.status === 'Accepted';
  } catch (error) {
    console.error('RemoteStopTransaction Error:', error);
    return false;
  }
}
