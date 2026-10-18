// Print the job list for run-queue.sh: pieces of one arm, each "bp bd from to remToSym".
//   node queue-jobs.js <bp> <bd> <from> <to> <pieceDeg> <remToSym>
const [bp, bd, from, to, piece, sym] = process.argv.slice(2).map(Number);
const n = Math.ceil((to - from) / piece - 1e-9);
for (let i = 0; i < n; i++) {
  const a = i === 0 ? from : from + i * piece, b = i === n - 1 ? to : from + (i + 1) * piece;
  console.log(`${bp} ${bd} ${a} ${b} ${sym}`);
}
