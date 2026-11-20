import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3003';

// Middleware: parses incoming JSON bodies into req.body.
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

app.post('/orders', async (req, res) => {
  const { customerId, amount, item } = (req.body ?? {}) as {
    customerId?: unknown;
    amount?: unknown;
    item?: unknown;
  };

  if (typeof customerId !== 'string' || typeof amount !== 'number' || typeof item !== 'string') {
    res.status(400).json({
      error: 'customerId (string), amount (number), item (string) are required',
    });
    return;
  }

  const orderId = `ord_${randomUUID()}`;

  // --- Step A: payment (must succeed, or the whole order fails) ---
  let payment: { paymentId: string; status: string };
  try {
    const response = await fetch(`${PAYMENT_SERVICE_URL}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, amount }),
    });
    if (!response.ok) {
      throw new Error(`payment service responded with HTTP ${response.status}`);
    }
    payment = (await response.json()) as { paymentId: string; status: string };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // 502: we are fine, but a server we depend on is not
    res.status(502).json({ orderId, status: 'rejected', error: 'payment_unavailable', detail });
    return;
  }

  // --- Step B: notification (best effort — order stays confirmed even if this fails) ---
  let notification: { notificationId?: string; status: string; detail?: string };
  try {
    const response = await fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId, type: 'order_confirmation' }),
    });
    if (!response.ok) {
      throw new Error(`notification service responded with HTTP ${response.status}`);
    }
    notification = (await response.json()) as { notificationId: string; status: string };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    notification = { status: 'unavailable', detail }; // order still confirmed
  }

  res.status(201).json({
    orderId,
    status: 'confirmed',
    customerId,
    item,
    payment,
    notification,
  });
});

app.listen(PORT, () => {
  console.log(`[order-service] listening on http://localhost:${PORT}`);
});
