from pathlib import Path
p = Path("tmp_verify_profile.js")
text = p.read_text()
old = """    const signInRes = await fetch(base + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ csrfToken, email, password, role: 'student', callbackUrl: base }).toString(),
      redirect: 'manual',
    });
"""
new = """    const signInRes = await fetch(base + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': Array.from(jar.entries()).map((k,v) => f'{k}={v}').join('; '),
      },
      body: new URLSearchParams({ csrfToken, email, password, role: 'student', callbackUrl: base }).toString(),
      redirect: 'manual',
    });
"""
if old not in text:
    raise SystemExit('expected signin block not found')
p.write_text(text.replace(old, new))
print('patched')
