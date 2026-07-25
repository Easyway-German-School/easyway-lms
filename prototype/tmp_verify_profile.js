const fetch = globalThis.fetch || require('node-fetch');
const base = 'http://localhost:3000';
const email = 'test+1784309169443@example.com';
const password = 'Test1234!';
const jar = new Map();

function storeCookiesFromResponse(headers) {
  if (!headers) return;
  const cookieHeaders = [];
  if (typeof headers.get === 'function') {
    const setCookie = headers.get('set-cookie');
    if (setCookie) cookieHeaders.push(setCookie);
  }
  if (typeof headers.raw === 'function') {
    const raw = headers.raw();
    if (raw && Array.isArray(raw['set-cookie'])) {
      cookieHeaders.push(...raw['set-cookie']);
    }
  }
  if (!cookieHeaders.length) return;

  for (const header of cookieHeaders) {
    const parts = header.split(/,\s*(?=[^;]+=)/);
    for (const part of parts) {
      const [cookie] = part.split(';');
      const [k, ...v] = cookie.split('=');
      if (k && v.length) jar.set(k.trim(), v.join('=').trim());
    }
  }
}

function logHeaders(label, headers) {
  const entries = {};
  for (const [key, value] of headers.entries()) {
    entries[key] = value;
  }
  console.log(label, JSON.stringify(entries));
}

const request = async (path, opts = {}) => {
  opts.headers = opts.headers || {};
  const cookies = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookies) opts.headers.cookie = cookies;
  const res = await fetch(base + path, opts);
  storeCookiesFromResponse(res.headers);
  const text = await res.text();
  return { status: res.status, url: res.url, text, headers: Object.fromEntries(res.headers) };
};

(async () => {
  try {
    const csrf = await request('/api/auth/csrf');
    console.log('CSRF', csrf.status, csrf.text.slice(0,200));
    let csrfToken = '';
    try { csrfToken = JSON.parse(csrf.text).csrfToken; } catch (error) { console.error('csrf parse failed', error); }
    const signInRes = await fetch(base + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: new URLSearchParams({ csrfToken, email, password, role: 'student', callbackUrl: base }).toString(),
      redirect: 'manual',
    });

    logHeaders('SIGNIN_HEADERS', signInRes.headers);
    storeCookiesFromResponse(signInRes.headers);
    const signInText = await signInRes.text();
    console.log('SIGNIN', signInRes.status, signInText.slice(0,200));
    if (signInRes.status === 302) {
      const redirectLocation = signInRes.headers.get('location');
      console.log('SIGNIN_REDIRECT', redirectLocation);
      if (redirectLocation) {
        let nextUrl = redirectLocation.startsWith('http') ? redirectLocation : base + redirectLocation;
        let redirectCount = 0;
        while (nextUrl && redirectCount < 5) {
          const redirectRes = await fetch(nextUrl, {
            headers: { cookie: Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ') },
            redirect: 'manual',
          });
          logHeaders(`REDIRECT_HEADERS_${redirectCount + 1}`, redirectRes.headers);
          storeCookiesFromResponse(redirectRes.headers);
          const nextLocation = redirectRes.headers.get('location');
          console.log(`REDIRECT_${redirectCount + 1}`, redirectRes.status, nextLocation);
          if (!nextLocation || redirectRes.status < 300 || redirectRes.status >= 400) break;
          nextUrl = nextLocation.startsWith('http') ? nextLocation : base + nextLocation;
          redirectCount += 1;
        }
      }
    }
    console.log('COOKIES', Object.fromEntries(jar));
    const profile = await request('/api/student/profile');
    console.log('PROFILE', profile.status, profile.text.slice(0,500));
    const save = await request('/api/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Test User Edited', email, phone: '+234 803 123 9999', gender: 'Female', dateOfBirth: '1998-05-14', address: '123 New Street', branch: 'Abuja', currentLevel: 'A1', currentCourse: 'Goethe exam mastery', preferredExam: 'Internal Easyway exam' }),
    });
    console.log('SAVE', save.status, save.text.slice(0,500));
    const profile2 = await request('/api/student/profile');
    console.log('PROFILE2', profile2.status, profile2.text.slice(0,500));
  } catch (error) {
    console.error('ERROR', error);
  }
})();
