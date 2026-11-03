# Platter

AI agents that sell food better than humans.

Platter is a meal-builder widget for restaurant websites. Guests say who's eating, the meal, their preferences and their budget, and Platter builds a ready-to-order combo from the restaurant's real menu.

## What's here

- `public/index.html`: a demo set up with Sausalido Cafe's public menu (Torrance, CA). The combo engine runs in the browser.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000.

## Deploy

Hosted on Railway, which deploys automatically on every push to `main`.

## Next

- Connect Square's Catalog API so menus and prices sync live
- One-tap "Add to order" into the restaurant's Square cart
- An embeddable `<script>` snippet so the widget drops into any restaurant site
