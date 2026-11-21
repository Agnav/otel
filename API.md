# API Contracts

## Order Service — `http://localhost:3101`

### POST /orders

Request:

```ts
{
  customerId: string;
  amount: number;
  item: string;
}
```

Responses:

| Code | Body |
|------|------|
| 201 | `{ orderId: string; status: "confirmed"; customerId: string; item: string; payment: { paymentId: string; status: string }; notification: { notificationId?: string; status: string; detail?: string } }` |
| 400 | `{ error: string }` |
| 502 | `{ orderId: string; status: "rejected"; error: "payment_unavailable"; detail: string }` |

### GET /health

Responses:

| Code | Body |
|------|------|
| 200 | `{ status: "ok"; service: "order-service" }` |

---

## Payment Service — `http://localhost:3102`

### POST /payments

Request:

```ts
{
  orderId: string;
  amount: number;
}
```

Responses:

| Code | Body |
|------|------|
| 201 | `{ paymentId: string; orderId: string; status: "succeeded"; amount: number; processedAt: string }` |
| 400 | `{ error: string }` |

### GET /health

Responses:

| Code | Body |
|------|------|
| 200 | `{ status: "ok"; service: "payment-service" }` |

---

## Notification Service — `http://localhost:3103`

### POST /notifications

Request:

```ts
{
  orderId: string;
  type: string;
}
```

Responses:

| Code | Body |
|------|------|
| 201 | `{ notificationId: string; orderId: string; type: string; status: "sent"; sentAt: string }` |
| 400 | `{ error: string }` |

### GET /health

Responses:

| Code | Body |
|------|------|
| 200 | `{ status: "ok"; service: "notification-service" }` |
