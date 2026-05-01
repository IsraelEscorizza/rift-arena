import re, html as htmllib, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

raw = open('docs/precon/riftmana.html', encoding='utf-8').read()
text = re.sub(r'<script.*?</script>', ' ', raw, flags=re.S)
text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', '\n', text)
text = htmllib.unescape(text)
text = re.sub(r'\n\s*\n+', '\n', text)
out = []
for champ in ['Annie','Garen','Lux','Master Yi']:
    idx = text.find(f'{champ} Proving Grounds')
    if idx < 0:
        out.append(f'NOT FOUND: {champ}')
        continue
    end = idx + 8000
    next_section = -1
    for c2 in ['Annie','Garen','Lux','Master Yi']:
        if c2 == champ: continue
        ni = text.find(f'{c2} Proving Grounds', idx + 50)
        if ni > 0 and (next_section < 0 or ni < next_section):
            next_section = ni
    if next_section > 0 and next_section < end:
        end = next_section
    out.append(f'\n############ {champ} ############')
    out.append(text[idx:end])

with open('docs/precon/extracted.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))
print('done')
