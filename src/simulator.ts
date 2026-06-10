import { RPCClient } from 'ocpp-rpc';

async function startSimulator(chargerId: string) {
  console.log(`[Simulator] Starting charger ${chargerId}...`);

  const client = new RPCClient({
    endpoint: `ws://127.0.0.1:3000`,
    identity: chargerId,
    protocols: ['ocpp1.6'],
    strictMode: false,
  } as any);

  await client.connect();
  console.log(`[Simulator] Connected to backend! (${chargerId})`);

  // Send BootNotification
  await client.call('BootNotification', {
    chargePointVendor: 'Ebee',
    chargePointModel: 'Sim-1.0',
  });
  console.log(`[Simulator] BootNotification sent. (${chargerId})`);

  // Send StatusNotification
  await client.call('StatusNotification', {
    connectorId: 1,
    errorCode: 'NoError',
    status: 'Available',
  });
  console.log(`[Simulator] Status set to Available. (${chargerId})`);

  let chargingInterval: NodeJS.Timeout | null = null;
  let currentMeter = 10000; // 10 kWh initial

  // Handle RemoteStartTransaction
  client.handle('RemoteStartTransaction', async ({ params }: any) => {
    console.log(`[Simulator ${chargerId}] Received RemoteStartTransaction for idTag: ${params.idTag}`);
    
    // Simulate accepting the start
    setTimeout(async () => {
      console.log(`[Simulator ${chargerId}] Starting transaction...`);
      const startResult: any = await client.call('StartTransaction', {
        connectorId: 1,
        idTag: params.idTag,
        meterStart: currentMeter,
        timestamp: new Date().toISOString(),
      });
      console.log(`[Simulator ${chargerId}] Transaction Started! ID: ${startResult.transactionId}`);
      
      // Update status
      await client.call('StatusNotification', {
        connectorId: 1,
        errorCode: 'NoError',
        status: 'Charging',
      });

      // Start sending MeterValues every 10 seconds
      chargingInterval = setInterval(async () => {
        currentMeter += 150; // add 150 Wh
        await client.call('MeterValues', {
          connectorId: 1,
          transactionId: startResult.transactionId,
          meterValue: [{
            timestamp: new Date().toISOString(),
            sampledValue: [{ value: currentMeter.toString(), context: 'Sample.Periodic', format: 'Raw', measurand: 'Energy.Active.Import.Register', unit: 'Wh' }]
          }]
        });
        console.log(`[Simulator ${chargerId}] MeterValue sent: ${currentMeter} Wh`);
      }, 10000);
      
    }, 1000);

    return { status: 'Accepted' };
  });

  // Handle RemoteStopTransaction
  client.handle('RemoteStopTransaction', async ({ params }: any) => {
    console.log(`[Simulator ${chargerId}] Received RemoteStopTransaction for transaction: ${params.transactionId}`);
    
    if (chargingInterval) clearInterval(chargingInterval);

    setTimeout(async () => {
      const stopResult = await client.call('StopTransaction', {
        transactionId: params.transactionId,
        meterStop: currentMeter,
        timestamp: new Date().toISOString(),
      });
      console.log(`[Simulator ${chargerId}] Transaction Stopped!`);

      await client.call('StatusNotification', {
        connectorId: 1,
        errorCode: 'NoError',
        status: 'Available',
      });
      console.log(`[Simulator ${chargerId}] Status set to Available.`);
    }, 1000);

    return { status: 'Accepted' };
  });

  // Heartbeat loop
  setInterval(() => {
    client.call('Heartbeat', {});
  }, 60000);
}

async function startAll() {
  await startSimulator('CHARGER_001');
  await startSimulator('CHARGER_002');
  await startSimulator('CHARGER_003');
}

startAll().catch(console.error);
