"""The training corpus packed once into flat binary columns, so a run can train on all of it.

WHY
torch-train-core.py used to parse every selected nn/data/*.jsonl line into Python lists on every
run. A position is 94 numbers and a label -- ~400 bytes as float32 -- but several KB as Python
objects, so RAM capped training at the newest ~16% of the corpus (cap_files). Packed, the whole
corpus is a few GB of float32 on disk, opened as a memory map: the OS pages in what each batch
touches and the process holds only small per-row arrays.

WHAT IS STORED (nn/.packed/, gitignored, rebuilt from nn/data whenever needed)
  feats.<gen>.bin   float32 [rows, 94]   the feature vector, exactly as the JSONL had it
  z / sv            float64              outcome and search score (NaN when the row has none)
  svd               float32              search depth behind sv (0 when none)
  m                 int8                 side to move: 0/1, -1 when absent, -2 for anything else
  game / mover      int32                ids into games.txt / movers.txt (mover -1 when absent)
  index.json        per source file: bytes consumed, the row chunks it produced, the game-id
                    inference state, and the counts the JSONL loader reports (stale, no-f, policy)

Rows are parsed with the same rules as load_rows: no 'f' -> skipped, a 94-mismatch -> stale (the
run refuses, as before), arm+bin policy rows skipped, a missing 'g' inferred from |z| falling.
pose (p) is not stored: --poseInput keeps using the JSONL loader.

UPDATES are incremental and append-only. A file that grew is read from where the last pack
stopped; a file that was rewritten (shorter, or its first bytes changed) or deleted has its old
rows dropped from the index, and once dropped rows pass a quarter of the store it is rewritten as
a new generation. One process packs at a time (lock file); a reader only ever sees the row count
the index committed, so a run training while another packs reads a consistent store.
"""
import hashlib, json, math, os, sys, time
import numpy as np

N_FEATURES = 94
VERSION = 1
COLS = [('z', np.float64, ()), ('sv', np.float64, ()), ('svd', np.float32, ()), ('m', np.int8, ()),
        ('game', np.int32, ()), ('mover', np.int32, ()), ('feats', np.float32, (N_FEATURES,))]
HEAD_BYTES = 4096


def store_dir(nn_dir):
    return os.path.join(nn_dir, '.packed')


def _col_path(sd, col, gen):
    return os.path.join(sd, '%s.%d.bin' % (col, gen))


def _row_bytes(dtype, shape):
    return np.dtype(dtype).itemsize * (int(np.prod(shape)) if shape else 1)


def _new_index():
    return {'version': VERSION, 'gen': 0, 'rows': 0, 'garbage': 0,
            'games': 0, 'gamesBytes': 0, 'movers': 0, 'moversBytes': 0, 'files': {}}


def _read_index(sd):
    try:
        with open(os.path.join(sd, 'index.json'), 'r', encoding='utf-8') as fh:
            idx = json.load(fh)
        if idx.get('version') == VERSION:
            return idx
    except (OSError, ValueError):
        pass
    return None


def _write_index(sd, idx):
    tmp = os.path.join(sd, 'index.json.tmp-%d' % os.getpid())
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(idx, fh)
    for attempt in range(50):          # Windows: a reader may hold index.json open for a moment
        try:
            os.replace(tmp, os.path.join(sd, 'index.json'))
            return
        except PermissionError:
            time.sleep(0.1)
    os.replace(tmp, os.path.join(sd, 'index.json'))


class _Lock:
    """One packer at a time. The holder touches the lock as it works (beat), so a lock that has not
    been touched for STALE seconds belongs to a packer that died -- a trainer killed mid-pack -- and
    is taken over instead of making every later run wait it out."""
    STALE = 600
    BEAT = 20

    def __init__(self, sd, wait_s):
        self.path, self.wait_s, self.held, self.last = os.path.join(sd, 'lock'), wait_s, False, 0.0

    def __enter__(self):
        t0 = time.time()
        while True:
            try:
                fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, ('%d %f' % (os.getpid(), time.time())).encode())
                os.close(fd)
                self.held, self.last = True, time.time()
                return self
            except FileExistsError:
                try:
                    if time.time() - os.path.getmtime(self.path) > self.STALE:
                        os.remove(self.path)
                        continue
                except OSError:
                    continue
                if time.time() - t0 > self.wait_s:
                    return self          # not held: the caller reads what is committed
                time.sleep(2)

    def beat(self):
        if self.held and time.time() - self.last > self.BEAT:
            self.last = time.time()
            try:
                os.utime(self.path, None)
            except OSError:
                pass

    def __exit__(self, *a):
        if self.held:
            try:
                os.remove(self.path)
            except OSError:
                pass


def _table_load(sd, name, count):
    """games.txt / movers.txt: one JSON value per line, line i is id i."""
    vals = []
    try:
        with open(os.path.join(sd, name), 'rb') as fh:
            for line in fh:
                if len(vals) >= count:
                    break
                vals.append(json.loads(line))
    except OSError:
        pass
    return vals


def _head_hash(path, n):
    with open(path, 'rb') as fh:
        return hashlib.sha1(fh.read(n)).hexdigest()


def _append_at(path, offset, data):
    """Write data at offset, creating the file if needed. Never truncates: on Windows a file that
    another process has memory-mapped cannot be shrunk, and anything past the committed length is
    invisible to readers anyway."""
    mode = 'r+b' if os.path.exists(path) else 'w+b'
    with open(path, mode) as fh:
        fh.seek(offset)
        fh.write(data)


def _mover_name(mv, _re=[]):
    if not _re:
        import re
        _re.append(re.compile(r'(\+P)?@D[1-9]$'))
    return _re[0].sub('', str(mv))


class _Sink:
    """Rows on their way to the column files, flushed every FLUSH rows so packing a multi-GB corpus
    never holds more than a slice of it in memory."""
    FLUSH = 100000

    def __init__(self, sd, gen, rows0, beat=None):
        self.sd, self.gen, self.rows0, self.written, self.beat = sd, gen, rows0, 0, beat
        self.buf = {c: [] for c, _, _ in COLS}

    def count(self):
        return self.written + len(self.buf['z'])

    def add(self, z, sv, svd, m, game, mover, f):
        b = self.buf
        b['z'].append(z); b['sv'].append(sv); b['svd'].append(svd); b['m'].append(m)
        b['game'].append(game); b['mover'].append(mover); b['feats'].append(f)
        if len(b['z']) >= self.FLUSH:
            self.flush()

    def flush(self):
        n = len(self.buf['z'])
        if not n:
            return
        for col, dt, shape in COLS:
            arr = np.asarray(self.buf[col], dtype=dt)
            if shape:
                arr = arr.reshape((-1,) + shape)
            _append_at(_col_path(self.sd, col, self.gen), (self.rows0 + self.written) * _row_bytes(dt, shape),
                       arr.tobytes())
            self.buf[col] = []
        self.written += n
        if self.beat:
            self.beat()


def _lines(path, start, block=1 << 24):
    """(line bytes, end offset of that line) for each complete line from byte `start`, read in
    blocks. An unfinished last line is left for the next pack."""
    with open(path, 'rb') as fh:
        fh.seek(start)
        pos, carry = start, b''
        while True:
            data = fh.read(block)
            if not data:
                return
            data = carry + data
            cut = data.rfind(b'\n') + 1
            carry = data[cut:]
            for raw in data[:cut].split(b'\n')[:-1]:
                pos += len(raw) + 1
                yield raw, pos


def _parse_file(path, name, start, state, game_ids, game_list, mover_ids, mover_list, sink):
    """Parse complete lines from byte `start` into sink; returns the byte offset reached. Same row
    rules as torch-train-core.load_rows. state carries the |z| game-boundary inference across calls."""
    inferred, prev_abs, cur = state['inferred'], state['prev_abs'], state['cur']
    prev_abs = float('inf') if prev_abs is None else prev_abs
    reached = start
    for raw, reached in _lines(path, start):
        line = raw.decode('utf-8', errors='replace').strip()
        if not line:
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        if not isinstance(j, dict):
            continue
        f = j.get('f')
        if not f:
            state['nof'] += 1
            continue
        if len(f) != N_FEATURES:
            state['stale'] += 1
            continue
        if j.get('arm') is not None and j.get('bin') is not None:
            state['policy'] += 1
            continue
        try:
            z = float(j.get('z', 0.0) or 0.0)
            sv = j.get('sv')
            sv = float('nan') if sv is None else float(sv)
            svd = float(j.get('svd') or 0)
        except (TypeError, ValueError):
            continue
        g = j.get('g')
        if g is None:
            a = abs(z)
            if a < prev_abs:
                inferred += 1
                cur = '%s#%d' % (name, inferred)
            prev_abs = a
            g = cur
        else:
            prev_abs = float('inf')
        key = json.dumps(g)
        gid = game_ids.get(key)
        if gid is None:
            gid = game_ids[key] = len(game_list)
            game_list.append(key)
        mv = j.get('mv')
        if mv is None:
            mid = -1
        else:
            mname = _mover_name(mv)
            mid = mover_ids.get(mname)
            if mid is None:
                mid = mover_ids[mname] = len(mover_list)
                mover_list.append(mname)
        m = j.get('m')
        m8 = -1 if m is None else (int(m) if m in (0, 1) else -2)
        sink.add(z, sv, svd, m8, gid, mid, f)
    state['inferred'], state['prev_abs'], state['cur'] = inferred, (None if prev_abs == float('inf') else prev_abs), cur
    return reached


def update(nn_dir, paths, log=print, wait_s=1800):
    """Bring nn/.packed up to date with `paths` (the corpus files). Returns the committed index."""
    sd = store_dir(nn_dir)
    os.makedirs(sd, exist_ok=True)
    with _Lock(sd, wait_s) as lock:
        idx = _read_index(sd) or _new_index()
        if not lock.held:
            log('packed data: another run is packing; training on what it has committed so far')
            return idx
        gen, files = idx['gen'], idx['files']
        games = _table_load(sd, 'games.txt', idx['games'])
        movers = _table_load(sd, 'movers.txt', idx['movers'])
        game_ids = {k: i for i, k in enumerate(games)}
        mover_ids = {k: i for i, k in enumerate(movers)}
        n_games0, n_movers0 = len(games), len(movers)
        present = {}
        for p in paths:
            try:
                present[os.path.basename(p)] = (p, os.path.getsize(p))
            except OSError:
                pass
        for name in list(files):
            if name not in present:
                idx['garbage'] += sum(c for _, c in files.pop(name)['chunks'])
        rows0 = idx['rows']
        sink = _Sink(sd, gen, rows0, lock.beat)
        new_files, touched, t0, last_note = 0, 0, time.time(), time.time()
        for name in sorted(present):
            lock.beat()
            p, size = present[name]
            ent = files.get(name)
            if ent is not None:
                hl = min(HEAD_BYTES, ent['consumed'])
                if size < ent['consumed'] or (hl and _head_hash(p, hl) != ent['head']):
                    idx['garbage'] += sum(c for _, c in ent['chunks'])
                    ent = None            # rewritten in place: re-read it from the start
                elif size == ent['consumed']:
                    continue
            if ent is None:
                ent = files[name] = {'consumed': 0, 'head': '', 'chunks': [], 'inferred': 0,
                                     'prev_abs': None, 'cur': None, 'stale': 0, 'nof': 0, 'policy': 0}
                new_files += 1
            before = sink.count()
            reached = _parse_file(p, name, ent['consumed'], ent, game_ids, games, mover_ids, movers, sink)
            if reached <= ent['consumed']:
                continue
            ent['consumed'] = reached
            touched += 1
            ent['head'] = _head_hash(p, min(HEAD_BYTES, reached))
            got = sink.count() - before
            if got:
                start = rows0 + before
                if ent['chunks'] and ent['chunks'][-1][0] + ent['chunks'][-1][1] == start:
                    ent['chunks'][-1][1] += got
                else:
                    ent['chunks'].append([start, got])
            if time.time() - last_note > 30:
                last_note = time.time()
                log('packed data: %d new rows so far (at %s)' % (sink.count(), name))
        sink.flush()
        added = sink.written
        idx['rows'] = rows0 + added
        for name_, lst, n0, key in (('games.txt', games, n_games0, 'games'), ('movers.txt', movers, n_movers0, 'movers')):
            if len(lst) > n0:
                blob = b''.join(json.dumps(v).encode() + b'\n' for v in lst[n0:])
                _append_at(os.path.join(sd, name_), idx[key + 'Bytes'], blob)
                idx[key + 'Bytes'] += len(blob)
                idx[key] = len(lst)
        if added or touched:
            log('packed data: +%d rows from %d file(s) (%d new or rewritten) in %.0fs (store %d rows)'
                % (added, touched, new_files, time.time() - t0, idx['rows']))
        if idx['garbage'] > 100000 and idx['garbage'] * 4 > idx['rows']:
            idx = _compact(sd, idx, log, lock.beat)
        _write_index(sd, idx)
        _sweep_old_gens(sd, idx['gen'])
        return idx


def _compact(sd, idx, log, beat=lambda: None):
    """Rewrite the live rows as generation gen+1, file by file, so each file's rows are one chunk."""
    gen, new_gen, t0 = idx['gen'], idx['gen'] + 1, time.time()
    old = {col: np.memmap(_col_path(sd, col, gen), dtype=dt, mode='r', shape=(idx['rows'],) + shape)
           for col, dt, shape in COLS} if idx['rows'] else {}
    handles = {col: open(_col_path(sd, col, new_gen), 'wb') for col, _, _ in COLS}
    pos = 0
    try:
        for name in sorted(idx['files']):
            beat()
            ent = idx['files'][name]
            n = sum(c for _, c in ent['chunks'])
            if n:
                sel = np.concatenate([np.arange(s, s + c, dtype=np.int64) for s, c in ent['chunks']])
                for col, _, _ in COLS:
                    handles[col].write(np.ascontiguousarray(old[col][sel]).tobytes())
            ent['chunks'] = [[pos, n]] if n else []
            pos += n
    finally:
        for h in handles.values():
            h.close()
        del old
    log('packed data: compacted %d live rows (%d dropped) in %.0fs' % (pos, idx['rows'] - pos, time.time() - t0))
    idx.update(gen=new_gen, rows=pos, garbage=0)
    return idx


def _sweep_old_gens(sd, gen):
    for f in os.listdir(sd):
        parts = f.split('.')
        if len(parts) == 3 and parts[2] == 'bin' and parts[1].isdigit() and int(parts[1]) != gen:
            try:
                os.remove(os.path.join(sd, f))
            except OSError:
                pass                      # still mapped by a running trainer; next pack retries


class Packed:
    """The committed store, memory-mapped, plus the rows of the selected files in JSONL order."""
    def __init__(self, nn_dir, idx, selected_paths):
        sd = store_dir(nn_dir)
        n = idx['rows']
        self.cols = {}
        for col, dt, shape in COLS:
            self.cols[col] = (np.memmap(_col_path(sd, col, idx['gen']), dtype=dt, mode='r', shape=(n,) + shape)
                              if n else np.zeros((0,) + shape, dtype=dt))
        self.games = _table_load(sd, 'games.txt', idx['games'])
        self.movers = _table_load(sd, 'movers.txt', idx['movers'])
        parts, self.stale, self.nof, self.policy, self.missing = [], {}, 0, 0, []
        for p in sorted(selected_paths):
            ent = idx['files'].get(os.path.basename(p))
            if ent is None:
                self.missing.append(os.path.basename(p))
                continue
            for s, c in ent['chunks']:
                parts.append(np.arange(s, s + c, dtype=np.int64))
            if ent['stale']:
                self.stale[os.path.basename(p)] = ent['stale']
            self.nof += ent['nof']
            self.policy += ent['policy']
        self.rows = np.concatenate(parts) if parts else np.zeros(0, dtype=np.int64)
        self.feats = self.cols['feats']
