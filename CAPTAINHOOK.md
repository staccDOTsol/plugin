# Captain Hook terminal

Live: https://captainhook.fun · API: https://api.captainhook.fun · Proof: https://project.captainhook.fun

This is the actual Jupiter Plugin/Terminal fork. Ordinary pairs use Jupiter Ultra; controlled hooked mints branch to a complete direct transaction builder. XEEu is the default, with 5oCp and DZVf in the dropdown. Both SOL buy and sell directions are implemented. A shared Standard Wallet provider supplies the same connected wallet to the Jupiter components and the auction form.

The API checks holder eligibility and simulates the whole trade before approval and again after signing. The client checks mint/recipient accounts, registered pool path, input cap, minimum output, bridge amounts, and hook metas. The backend only relays an unchanged buyer-signed prepared message. Preparation tokens are stateless HMAC receipts, so Fly load balancing does not break the prepare/submit flow.

## Auctions

English auction per controlled mint with anti-snipe extension. Terms (on-chain): 0.01 SOL minimum bid, 10% minimum raise, 30-minute clock that starts with the first bid, 5-minute extension for any bid inside the last 5 minutes. Bids escrow SOL in the auction PDA; the outbid leader is refunded in the same instruction. The browser validates the exact bid instruction (round, amount, proposed hook, refund account) before the wallet signs; the API only relays. When the clock runs out, 331n's authority settles payment, hook pointer, and a checked-transfer proof through the winning hook. A hook that cannot pass the proof gets the leader refunded and a new round. "Settle now" lets anyone poke settlement once bidding closes.

## Liquidity (Splash Pool for dummies)

The Liquidity tab walks a wallet through an Orca Splash Pool for any SPL or Token-2022 mint, including transfer-hook mints: read the pair (Birdeye price, Orca's address-based token order with the inversion explained and converted), issue a token badge and Splash fee tier on a config the wallet controls (Orca's program no longer lets wallets create new configs, so existing configs that already badge the mint are discovered too), initialize the pool with its two full-range tick arrays, open a full-range position with a previewed deposit, then increase, withdraw by percent, collect fees, or close. Every step is one wallet-signed packet simulated on mainnet; ephemeral accounts (vaults, position mint) are pre-signed by the API and listed in the receipt so the browser can verify the signer set. The browser allows only the expected Whirlpool instruction discriminators, SOL wrapping to the wallet's own WSOL account, and idempotent ATA creation.

## Build and verify

```sh
npm install
npx tsc --noEmit
npm run build-widget
npm run build
npx tsx scripts/test-client-validation.ts
node scripts/check-ui.mjs
node scripts/check-wallet-ui.mjs
```

`check-wallet-ui.mjs` registers a public-address-only Standard Wallet test adapter with signing disabled; it verifies actual connected-wallet eligibility and quote presentation without submitting a transaction. `check-ui.mjs` verifies the deployed controls and 1440/840/390-pixel layouts. Artifacts are written under ignored `test-results/`.

Deploy with `flyctl deploy --remote-only --app hooksare-fun --ha=false`. The app name is historical; its canonical domain and branding are Captain Hook. The Docker build pins npm 11.19.1 to match the lockfile resolver. Vercel manages DNS and Fly manages TLS certificates.

The upstream configurator shell is lazy-loaded only at `/demo` to keep its formatter dependencies out of the trading entry point. The Jupiter swap itself is still the fork's real widget, built from the edited source into `public/plugin-1.0.16*`.
