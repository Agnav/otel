import express from 'express';
import { randomUUID } from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT ?? 3002);

// Middleware: parses incoming JSON bodies into req.body.
// Without this, req.body would be undefined.
app.use(express.json());

interface PaymentResponse {
  paymentId: string;
  orderId: string;
  status: 'succeeded';
  amount: number;
  processedAt: string;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'payment-service' });
});

app.post('/payments', (req, res) => {
  const { orderId, amount } = (req.body ?? {}) as { orderId?: unknown; amount?: unknown };

  if (typeof orderId !== 'string' || typeof amount !== 'number') {
    res.status(400).json({ error: 'orderId (string) and amount (number) are required' });
    return;
  }

  // Phase 2: payment always succeeds. Failure simulation arrives in Phase 9.
  const payment: PaymentResponse = {
    paymentId: `pay_${randomUUID()}`,
    orderId,
    status: 'succeeded',
    amount,
    processedAt: new Date().toISOString(),
  };

  res.status(201).json(payment);
});

app.listen(PORT, () => {
  console.log(`[payment-service] listening on http://localhost:${PORT}`);
});
