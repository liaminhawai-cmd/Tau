# Comparing independent replays

22 September 2026. The original `summarize.py` checks a complete run's byte hashes and mathematical result gates. An intact archived chain works; mixing regenerated timing-bearing inputs with archived derived outputs correctly fails its hash checks. Keep that check.

For comparison BETWEEN runs, use the verifier from a trusted archive checkout:

```sh
node verify_replay.js --self-test
node /path/to/archive/verify_replay.js /path/to/fresh/arm2-propagation
```

The manifest is always read beside the verifier, not from the replay directory. Regenerate the complete fresh chain and run its `summarize.py` as well. Cross-run identity does not replace internal consistency or a review of the proof.

`replay-canonical.json` pins four fingerprints to archive commit `e65124f9db127f3e5b475e7a2b7f5c8e905e7f73`. Only the listed ROOT fields are removed: elapsed seconds, runtime label, and the two derivative propagation hashes (which incorporate elapsed time). All nested fields, unknown fields, numbers and array order remain significant. No tolerance is used for numeric comparison.

## Canonical format: tau-replay-binary64-v1

The output is ASCII. Null is `N`; booleans are `T` and `F`. A finite number is `D` followed by its 16 lowercase hexadecimal IEEE-754 binary64 bits in big-endian order, preserving negative zero. A string is `S`, four lowercase hexadecimal digits per UTF-16 code unit, then `;`. Arrays concatenate encodings between `[` and `]`. Objects concatenate encoded key/value pairs between `{` and `}`, sorting keys by JavaScript UTF-16 order. SHA-256 hashes this encoding. JSON whitespace, object order and equivalent numeric spellings are irrelevant; parsed numerical values are not.

Validation: Node executed 13 canonicalization checks and matched all four archive fingerprints. A separate CLI test changed all ignored metadata and passed; changing the final radius by 1e-9 failed with exit status 1. This verifies the comparison tool, not the geometry theorem.
