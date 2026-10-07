# Captain Hook terminal — design audit

Work pattern: **Operate**. Mint selection, quoting, signing, and repeated auction settlement are the work surface.

## Diagnosis before treatment

| Tell | Severity / 10 | Evidence |
| --- | ---: | --- |
| Tech gradient | 5 | `src/styles/globals.css:30,69`: inherited cyan/yellow gradient border. |
| Generic tech hue | 4 | `src/styles/globals.css:8-9`: generic blue-grey widget surfaces. |
| Feature-tile grid | 2 | `src/pages/index.tsx:58-62`: equally weighted explanatory facts ahead of the work. |
| Accent rail | 0 | No accent rail in the recovered page. |
| Unearned blur | 0 | Modal backdrop in `src/library.tsx:144` has an actual depth purpose. |
| Stat monument | 0 | No invented oversized metrics. |
| Icon topper | 0 | No repeated icon-topped feature cards. |
| Bounce everywhere | 0 | No elastic easing in the recovered surface. |
| Default type | 6 | `src/styles/globals.css:13`: default Inter everywhere, without a terminal hierarchy. |
| Center stack | 0 | The intended composition is asymmetric. |

Additional blockers: `src/pages/_app.tsx:7` imported a nonexistent `trader.css` (build blocker); `src/pages/index.tsx:52-75` framed a trading operation as a headline/story hero.

Treatment: **relayout + typeset + states + responsive**. Put a shared-wallet trading surface first, with a real mint dropdown, buy/sell direction, live route checks, and auction controls. Use warm, low-chroma dark neutrals and restrained brass in oklch, with IBM Plex for financial labels and addresses. Preserve the upstream Jupiter swap components and actual wallet/transaction flow.

State coverage targets: hover, pressed, focus-visible, disabled, loading, empty, error, success, and long-address overflow. Desktop has two operating columns; narrow view stacks the controls and the live inspector. The inherited two-state copy/load controls receive explicit error, loading, focus, and overflow treatment.

## Verified treatment

The operating surface now uses the actual Jupiter fork with a shared Standard Wallet provider, a controlled-mint dropdown, buy/sell direction, quote/simulation status, and a separate recurring-auction form. Browser verification passed at 1440, 840, and 390 pixels with no page overflow or JavaScript errors. Mint selection and auction/trade navigation were exercised for all three mints.

The original copy control's three observable states became six (idle, hover, pressed, focus, copied, copy failure). The loaded terminal covers loading, ready, error, disabled, hover, pressed, focus, and long-value overflow. The auction form additionally covers empty/disconnected, pending approval, submitting, and confirmed settlement.

Useful next review modes: **review** for a final visual audit and **states** when adding new markets or wallet adapters.
