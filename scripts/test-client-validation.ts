// Decode real mainnet-prepared packets with the browser's validator, then
// mutate their debit/minimum/recipient fields and ensure approval is refused.
import assert from 'node:assert/strict';
import { VersionedTransaction } from '@solana/web3.js';
import { CONTROLLED_MARKETS, CONTROLLER, THOOOK_HOOK, WSOL_MINT } from '../src/data/HookedOrcaRoutes';
import { AuctionPreparation, HookedOrcaPrepareResponse } from '../src/data/TraderApi';
import { validateCaptainBid, validateCaptainTrade } from '../src/data/ValidateCaptainTransaction';

const origin = process.env.TEST_API_ORIGIN || 'https://api.captainhook.fun';
const decoded = (encoded: string) => VersionedTransaction.deserialize(Buffer.from(encoded, 'base64'));
async function main() {
  for (const market of CONTROLLED_MARKETS) {
    for (const side of ['buy', 'sell']) {
      const amount = side === 'buy' ? '100000' : market.id === 'five' ? '100000' : '100000000';
      const inputMint = side === 'buy' ? WSOL_MINT : market.mint;
      const outputMint = side === 'buy' ? market.mint : WSOL_MINT;
      const response = await fetch(`${origin}/api/trader/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputMint, outputMint, amount, taker: CONTROLLER, swapMode: 'ExactIn' }) });
      const prepared = await response.json() as HookedOrcaPrepareResponse;
      assert.equal(response.status, 200, JSON.stringify(prepared));
      assert.equal(prepared.stage, 'swap');
      validateCaptainTrade(decoded(prepared.transaction), prepared, CONTROLLER, amount);
      const redirect = decoded(prepared.transaction);
      const close = redirect.message.compiledInstructions.find((ix) => ix.data.length === 1 && ix.data[0] === 9);
      assert(close); close.accountKeyIndexes[1] = close.accountKeyIndexes[0];
      assert.throws(() => validateCaptainTrade(redirect, prepared, CONTROLLER, amount));
      const extraDebit = decoded(prepared.transaction);
      const swap = extraDebit.message.compiledInstructions.find((ix) => ix.data.length > 20 &&
        extraDebit.message.staticAccountKeys[ix.programIdIndex].toBase58() !== '11111111111111111111111111111111');
      assert(swap); const view = new DataView(swap.data.buffer, swap.data.byteOffset, swap.data.byteLength);
      view.setBigUint64(8, view.getBigUint64(8, true) + BigInt(1), true);
      assert.throws(() => validateCaptainTrade(extraDebit, prepared, CONTROLLER, amount));
      console.log(JSON.stringify({ market: market.label, side, browserValidation: 'passed', mutatedPacketsRejected: 2 }));
    }
  }
  const { auctions } = await (await fetch(`${origin}/api/trader/auctions`)).json() as { auctions: { mint: string; round: string; minNextBidLamports: string }[] };
  const auction = auctions.find((entry) => entry.mint === CONTROLLED_MARKETS[0].mint);
  assert(auction);
  const response = await fetch(`${origin}/api/trader/auction/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mint: CONTROLLED_MARKETS[0].mint, buyer: CONTROLLER, programId: THOOOK_HOOK, round: auction.round, bidLamports: auction.minNextBidLamports }) });
  const prepared = await response.json() as AuctionPreparation;
  assert.equal(response.status, 200, JSON.stringify(prepared));
  validateCaptainBid(decoded(prepared.transaction), prepared, CONTROLLER);
  const mutation = decoded(prepared.transaction);
  const bid = mutation.message.compiledInstructions.find((ix) => ix.data[0] === 7 && ix.data.length === 49);
  assert(bid); new DataView(bid.data.buffer, bid.data.byteOffset, bid.data.byteLength).setBigUint64(9, BigInt(prepared.bidLamports) - BigInt(1), true);
  assert.throws(() => validateCaptainBid(mutation, prepared, CONTROLLER));
  const redirect = decoded(prepared.transaction);
  const bid2 = redirect.message.compiledInstructions.find((ix) => ix.data[0] === 7 && ix.data.length === 49);
  assert(bid2); bid2.accountKeyIndexes[4] = bid2.accountKeyIndexes[0];
  assert.throws(() => validateCaptainBid(redirect, prepared, CONTROLLER));
  console.log(JSON.stringify({ bidBrowserValidation: 'passed', changedBidRejected: true, refundRedirectRejected: true }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
