// Score -> Elo, with an honest error bar. One place, because three files were each printing their
// own "N% +/- M points" and a percentage is a bad unit for the question actually being asked.
//
// Why Elo rather than a win-rate confidence interval:
//   - It is the unit the rest of the project already thinks in. elo-summary.json rates every brain
//     on it, the ladder rungs sit ~60-180 Elo apart, and eloweight.js weights training rows by it.
//     "52% +/- 10" needs translating before it can be compared to any of that; "+14 +/- 69 Elo"
//     does not, and lands immediately against "one ladder rung is worth ~100".
//   - It is linear in strength where a win rate is not. The distance from 50% to 55% is not the
//     same amount of strength as 90% to 95% (35 Elo vs 140), so averaging or comparing percentages
//     across matchups quietly mixes units. Elo differences are additive and transitive by
//     construction, which is the whole reason rating systems use them.
//   - It states the thing being decided. The question is never "is this exactly 50.0%", it is "how
//     much stronger, and could that be zero" -- which is an interval around a difference.
//
// elo = 400 * log10(p / (1 - p)), the same convention elorank.js fits on.
//
// The interval comes from the delta method on that transform: with p ~ (p(1-p)/n) variance,
//   d(elo)/dp = 400 / (ln10 * p * (1-p))
//   sigma_elo = 400 / (ln10 * sqrt(n * p * (1-p)))
// At p=0.5 that is ~347/sqrt(n): 100 decided games is +/-35 Elo at one sigma, +/-69 at two -- which
// is the real reason a 24-game arena match can almost never resolve anything, stated in units that
// make it obvious rather than buried in a percentage.
//
// A clean sweep (p=0 or 1) has no finite Elo, so scores use the Haldane-Anscombe correction
// (w+0.5)/(n+1) throughout. Applied always, not just at the extremes, so there is no discontinuity
// between "6-0" and "6-1" and no branch where two different formulas could disagree.
'use strict';

const LN10 = Math.LN10;

// w/l may be fractional -- arena.js scores a komi win as CFG.komiLoss of a win, and that partial
// credit should reach the rating rather than be rounded away.
function eloFromScore(w, l, sigmas) {
  const n = w + l;
  const k = sigmas == null ? 2 : sigmas;
  if (!(n > 0)) return { elo: null, sigma: null, lo: null, hi: null, n: 0, verdict: 'no data yet' };
  const p = (w + 0.5)/(n + 1);                       // Haldane-Anscombe, always finite
  const elo = 400*Math.log10(p/(1 - p));
  const sigma = 400/(LN10*Math.sqrt(n*p*(1 - p)));
  const lo = elo - k*sigma, hi = elo + k*sigma;
  // Same three-way call the project already used on win rates, now on a difference against zero.
  const verdict = lo > 0 ? 'beats' : hi < 0 ? 'loses' : 'undecided';
  return { elo, sigma, lo, hi, n, p, verdict };
}

// "+14 +/- 69 Elo" -- signed, because the sign is the answer and a bare "14" reads as a magnitude.
function fmtElo(r, digits) {
  if (r.elo == null) return 'no data';
  const d = digits == null ? 0 : digits;
  const s = r.elo >= 0 ? '+' : '';
  return `${s}${r.elo.toFixed(d)} +/- ${(2*r.sigma).toFixed(d)} Elo`;
}

module.exports = { eloFromScore, fmtElo };
