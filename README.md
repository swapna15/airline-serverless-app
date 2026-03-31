This is a [Next.js](https://nextjs.org) airline system with:

- flight search
- booking with seat selection
- flight/seat management
- DynamoDB-backed APIs

## Getting Started

## Local app setup

1) Install dependencies:

```bash
npm install
```

2) Copy env values:

```bash
cp .env.example .env.local
```

3) Ensure your AWS credentials are configured (for DynamoDB access), then run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Terraform (DynamoDB tables)

Terraform config is in `infra/terraform/main.tf` and provisions:

- `airline-flights` (with `route-date-index` GSI)
- `airline-seats`
- `airline-bookings`

Run:

```bash
cd infra/terraform
terraform init
terraform apply
```

Then use the table names in `.env.local`.

## Serverless API deployment

Terraform also provisions:

- HTTP API Gateway
- Lambda functions for:
  - `GET /api/flights`
  - `GET /api/flights/{flightId}/seats`
  - `PATCH /api/flights/{flightId}/seats`
  - `POST /api/bookings`
  - `GET /api/bookings/{bookingId}`

After `terraform apply`, set:

```bash
NEXT_PUBLIC_API_URL=<api_gateway_url output>
```

Then restart `npm run dev`.

## Notes

- The API auto-seeds sample flights/seats on first read when the flights table is empty.
- Keep your AWS credentials secure (do not commit `.env.local`).

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Terraform AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
