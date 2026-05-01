import re, html as htmllib, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

raw = open('docs/precon/champ-decks.html', encoding='utf-8').read()
text = re.sub(r'<script.*?</script>', ' ', raw, flags=re.S)
text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', '\n', text)
text = htmllib.unescape(text)
text = re.sub(r'\n\s*\n+', '\n', text)
out = open('docs/precon/champ-decks.txt', 'w', encoding='utf-8')
out.write(text)
out.close()
print('len=', len(text))
# Try to find decklist sections
for needle in ['Annie Proving', 'Garen Proving', 'Lux Proving', 'Master Yi Proving', 'Decklist', 'OGS-']:
    idx = text.find(needle)
    print(f'{needle}: {idx}')
