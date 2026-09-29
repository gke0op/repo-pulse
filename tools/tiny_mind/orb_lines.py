# Parse and check the orb's one-liners (DeepSeek markdown tables) -> accepted JSONL + a report.
# usage: python3 orb_lines.py batch1.md batch2.md ... [--out data/orb_lines.jsonl]
import re, sys, json, collections
MOMENTS = {'chat', 'tour', 'self', 'touch', 'idle', 'return', 'become'}
FEELINGS = {'calm', 'happy', 'sad', 'angry', 'surprised', 'curious', 'tender'}
ACTIONS = {'', 'become:mira', 'become:kai', 'confirm:seven', 'replay'}
NEEDS_USER = {'chat', 'touch', 'idle', 'return', 'become'}
PROGRESS = {'[early]', '[halfway]', '[almost]'}  # optional `user says` for tour rows
BANNED = ['how can i help', 'as an ai', 'here to assist', 'great question', 'cosmic', 'stardust',
          'universe', 'vibes', 'ethereal', 'journey', 'embrace', 'language model', 'tiny model', '#']
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿️]')
SPLIT = re.compile(r'(?<=[.!?…])["”’)]*\s+(?=\S)')
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', s.lower()).split()

def rows(path):
    for n, line in enumerate(open(path, encoding='utf-8'), 1):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) < 5 or not cells[0].isdigit():
            continue  # header, separator, prose
        yield n, cells

def check(c, seen, near):
    if len(c) != 6: return f'{len(c)} cells (need 6)'
    _, moment, user, feeling, orb, action = c
    moment, feeling, action = moment.lower(), feeling.lower().strip('[]'), action.lower().strip('`')
    if moment not in MOMENTS: return f'moment "{moment}"'
    if feeling not in FEELINGS: return f'feeling "{feeling}"'
    if action not in ACTIONS: return f'action "{action}"'
    if (moment == 'become') != (action != ''): return 'action/moment mismatch'
    if moment == 'tour' and user.lower() in PROGRESS: user = user.lower()  # how far the big brain is
    elif (moment in NEEDS_USER) != bool(user): return 'user says missing' if moment in NEEDS_USER else 'user says should be empty'
    if re.search(r'\{(?!name\})[^}]*\}', orb + user): return 'unknown {placeholder}'
    if len(SPLIT.split(orb)) > 1: return 'more than one sentence'
    if not re.search(r'[.!?…]$', orb): return 'no end punctuation'
    words = len(orb.split())
    if not 3 <= words <= 22: return f'{words} words'
    low = orb.lower()
    for b in BANNED:
        if b in low: return f'banned "{b}"'
    if EMOJI.search(orb): return 'emoji'
    if re.search(r'\*[^*]+\*|\([^)]*\)|^["“]', orb): return 'stage direction or quotes'
    key = ' '.join(norm(orb))
    if key in seen: return 'duplicate'
    w = norm(orb); nk = (' '.join(w[:5]), ' '.join(w[-3:]))
    if len(w) >= 8 and nk in near: return 'near-duplicate'
    seen.add(key); near.add(nk)
    return dict(moment=moment, user=user, feeling=feeling, orb=orb, action=action)

if __name__ == '__main__':
    args = sys.argv[1:]; out = 'data/orb_lines.jsonl'
    if '--out' in args: i = args.index('--out'); out = args[i + 1]; del args[i:i + 2]
    seen, near, kept = set(), set(), []
    why = collections.Counter(); examples = collections.defaultdict(list)
    for path in args:
        for n, c in rows(path):
            r = check(c, seen, near)
            if isinstance(r, str):
                reason = r.split(' "')[0] if r.startswith(('banned', 'moment', 'feeling', 'action "')) else re.sub(r'^\d+ ', 'N ', r)
                why[reason] += 1
                if len(examples[reason]) < 3: examples[reason].append(f'{path}:{n} ({r}) {c[4] if len(c) > 4 else c}')
            else:
                r['src'] = f'{path}:{n}'; kept.append(r)
    with open(out, 'w') as f:
        for r in kept: f.write(json.dumps(r, ensure_ascii=False) + '\n')
    total = len(kept) + sum(why.values())
    print(f'{len(kept)}/{total} rows kept -> {out}')
    for reason, k in why.most_common():
        print(f'  rejected {k:4d}  {reason}'); [print('      ', e) for e in examples[reason]]
    for field in ('moment', 'feeling', 'action'):
        cnt = collections.Counter(r[field] or '-' for r in kept)
        print(f'{field}: ' + ', '.join(f'{k} {v / len(kept):.0%}' for k, v in cnt.most_common()))
    openers = collections.Counter(norm(r['orb'])[0] for r in kept if norm(r['orb']))
    print('top openers: ' + ', '.join(f'"{w}" {v / len(kept):.1%}' for w, v in openers.most_common(6)))
