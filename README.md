# Foodol

Trust me, I've tried everything here.

Foodol lives on a QR code at the restaurant. Guests answer two quick questions (who's eating, what they're craving) and Foodol holds up three combo cards. They pick one, show the ticket to the cashier, and get a free extra. The cashier taps "Mark as redeemed", which uses the code once and counts it for the owner.

## Pieces
- `public/index.html`: the guest app (Sausalido Cafe menu, combo engine, ticket)
- `server.js`: serves the app, creates one-time combo codes, handles redeem, owner stats at `/owner?key=OWNER_KEY`
- Orders are stored in `DATA_DIR/orders.jsonl` (a Railway volume at `/data`)

## Run locally
    npm start   # http://localhost:3000, owner stats at /owner?key=dev

## Settings
- `OWNER_KEY`: password for the owner stats page
- `DATA_DIR`: where orders are stored (default `./data`)
- Free extra: `FREE_EXTRA` at the top of the script in `public/index.html`

## Cloudflare (Workers)

`wrangler.jsonc` + `src/worker.js` run the same app on Cloudflare Workers:
static files from `public/`, orders in a SQLite-backed Durable Object.
Set the `OWNER_KEY` secret in the Worker's settings for `/owner?key=...`.
Local: `npx wrangler dev`. Deploy: connected GitHub repo, or `npx wrangler deploy`.
