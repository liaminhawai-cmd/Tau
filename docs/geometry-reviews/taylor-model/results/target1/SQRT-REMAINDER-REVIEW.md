# Review note: square-root Taylor remainder refactor

Date: 11 October 2026  
Sources reviewed: [refactor commit 344e35c](https://github.com/liaminhawai-cmd/Tau/commit/344e35c05d554af0930c62245dca613ed6cb922c), [analytic test commit d8b9d13](https://github.com/liaminhawai-cmd/Tau/commit/d8b9d13f2a32026667fde2f52c54dd376ddd7871)

## Finding

The commit message describes the earlier square-root Lagrange remainder as too small when the lower input bound is greater than 1. The exact code diff does **not** appear to support that diagnosis.

For positive (x_{min}), the old expression was:

```js
const p = iv.mul(iv.sqrt([xmin, xmin]), [1, 1]);
let v = iv.div(p, iv.mul([xmin, xmin], [1, 1]));
for (let k = 1; k <= order; k++) v = iv.div(v, [xmin, xmin]);
```

Ignoring outward-rounding widths, this is

`sqrt(xmin) / xmin / xmin^order = xmin^(-order - 1/2)`.

The replacement expression is:

```js
let v = iv.div([1, 1], iv.sqrt([xmin, xmin]));
for (let k = 1; k <= order; k++) v = iv.div(v, [xmin, xmin]);
```

It has the same real-arithmetic value, `xmin^(-order - 1/2)`. Both versions use the same outward-rounded interval operations. The new form may be clearer and marginally tighter, but the diff alone does not show an exponent correction or a missing factor being repaired.

## Checks performed

I re-evaluated both expressions using the branch's `iv.js` source (blob `5dbfe6455ea58fe3a9c757b5122c8b665c03805f`) against the analytic Lagrange-bound formula

`abs(binomial(1/2, order+1)) * h^(order+1) * xmin^(-order-1/2)`.

- The four inputs in `test-tm.js`'s `sqrtLag` regression produced upper bounds from both the old and new expressions.
- A seeded 5,000-case diagnostic used positive `xmin` in [1e-8, 1e8], positive `h` in [1e-8, 1e4], and orders 1–10. Neither expression underbounded the analytic value in any case; the smallest old-formula ratio was 1.0000000000000022 and the smallest new-formula ratio was 1.000000000000002.

These are numerical checks, not a proof of the entire interval library. The algebraic equivalence is the important point: under the stated assumption that `iv.js` operations are sound outward enclosures, the old expression should also enclose the same Lagrange bound.

## Consequence for the proof status

Do not present the claim “the old expression was too small by a factor xmin for xmin > 1” as established on the basis of this diff. The new analytic test checks the replacement function but, as written, it does not distinguish the old expression—the legacy expression also passes the same input cases.

The corrected-formula branch and the new gap-slice certificate remain useful. The full cover rebuild can still be retained as a conservative reproducibility exercise, especially because exact margins can change by a few ulps. But the blanket statement that all prior covers are mathematically invalid *because of this particular square-root change* needs to be revisited. This note does not certify the entire Taylor-model implementation or replace an independent proof of `iv.js`, trigonometric bounds, Taylor remainders, contact branching, and the idealised game rules.
