// Exercise the real shared-wallet provider with a public-address Standard
// Wallet test adapter. Signing is disabled: no transaction can be submitted.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { PublicKey, Keypair } from '@solana/web3.js';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
async function check(address, eligible) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pubkey = Array.from(new PublicKey(address).toBytes());
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(({ address, pubkey }) => {
    const handlers = new Set();
    const account = { address, publicKey: Uint8Array.from(pubkey), chains: ['solana:mainnet'], features: ['solana:signTransaction'], label: 'Public-address QA account' };
    const wallet = { version: '1.0.0', name: 'Captain QA',
      icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjZTFiZDU1Ii8+PC9zdmc+',
      chains: ['solana:mainnet'], accounts: [], features: {
        'standard:connect': { version: '1.0.0', connect: async () => { wallet.accounts = [account]; handlers.forEach((handler) => handler({ accounts: wallet.accounts })); return { accounts: wallet.accounts }; } },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => { wallet.accounts = []; handlers.forEach((handler) => handler({ accounts: [] })); } },
        'standard:events': { version: '1.0.0', on: (_event, handler) => { handlers.add(handler); return () => handlers.delete(handler); } },
        'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: async () => { throw new Error('Signing intentionally disabled in public-address QA'); } },
      } };
    const register = (api) => api.register(wallet);
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
    window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));
  }, { address, pubkey });
  try {
    await page.goto('https://captainhook.fun', { waitUntil: 'domcontentloaded' });
    await page.locator('#captain-market').waitFor();
    await page.locator('#captain-wallet button').click();
    const choice = page.getByText('Captain QA', { exact: true });
    if (!await choice.isVisible()) {
      const more = page.getByText(/more wallets|view all|show all/i).first();
      if (await more.isVisible()) await more.click();
    }
    await choice.click();
    await page.getByText(eligible ? 'Existing holder · eligible' : 'Zero balance · access denied', { exact: true }).waitFor({ timeout: 60000 });
    if (eligible) {
      await page.getByRole('button', { name: 'Hook auctions', exact: true }).click();
      const bid = page.getByRole('button', { name: /^(Place the opening bid|Outbid the leader|Raise your own bid) ↗$/ });
      await bid.waitFor(); assert.equal(await bid.isEnabled(), true);
      await page.getByRole('button', { name: 'Trade', exact: true }).click();
      await page.getByText('Complete trade passed mainnet simulation for this wallet.', { exact: false }).first().waitFor({ timeout: 60000 });
    } else {
      await page.locator('#captain-swap').getByText('Existing holder required', { exact: true }).waitFor({ timeout: 60000 });
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ walletProvider: 'Standard Wallet shared by trader and auction', publicAddress: address,
      holderEligibility: eligible, signingDisabled: true, pageErrors: errors }));
  } finally { await page.close(); }
}
try {
  await check('331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth', true);
  await check(Keypair.generate().publicKey.toBase58(), false);
} finally { await browser.close(); }
