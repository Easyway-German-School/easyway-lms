const http = require('http');
const { URL } = require('url');
const BASE = 'http://localhost:3000';

function request(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let bodyData = data;
        try {
          bodyData = JSON.parse(data);
        } catch (e) {
          // ignore
        }
        resolve({ status: res.statusCode, body: bodyData, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function serializeCookies(cookieArray) {
  return cookieArray
    .map((cookie) => cookie.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

(async () => {
  try {
    console.log('Getting branches...');
    const branchesRes = await request('/api/branches', 'GET');
    console.log('branches status', branchesRes.status);
    const branchId = branchesRes.body?.branches?.[0]?.id;
    if (!branchId) {
      throw new Error('No branch id available');
    }
    const email = `e2e_student_${Date.now()}@easyway.example.com`;
    const password = 'Password123!';
    console.log('Signup email', email);

    const signupBody = JSON.stringify({
      email,
      password,
      name: 'E2E Student',
      role: 'student',
      branchId,
      level: 'A1',
      pathway: 'Goethe exam mastery',
      goal: 'Complete Goethe C1',
      phone: '08012345678',
      city: 'Lagos',
      address: '123 Easyway Street',
      dob: '2000-01-01',
    });

    const signupRes = await request('/api/auth/signup', 'POST', signupBody, {
      'Content-Type': 'application/json',
    });
    console.log('signup status', signupRes.status, signupRes.body);
    if (signupRes.status >= 400) {
      throw new Error('Signup failed');
    }

    console.log('Signing in...');
    const csrfRes = await request('/api/auth/csrf', 'GET');
    const csrfToken = csrfRes.body?.csrfToken;
    const csrfCookie = serializeCookies([...(Array.isArray(csrfRes.headers['set-cookie']) ? csrfRes.headers['set-cookie'] : [])]);
    console.log('csrf token', csrfToken, 'cookie', csrfCookie);

    const form = new URLSearchParams();
    form.set('csrfToken', csrfToken || '');
    form.set('email', email);
    form.set('password', password);
    form.set('role', 'student');
    form.set('callbackUrl', `${BASE}/dashboard`);
    form.set('json', 'true');

    const signinRes = await request('/api/auth/callback/credentials', 'POST', form.toString(), {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Cookie: csrfCookie,
    });
    console.log('signin status', signinRes.status, signinRes.body);
    const signinCookie = serializeCookies([...(Array.isArray(signinRes.headers['set-cookie']) ? signinRes.headers['set-cookie'] : [])]);
    const cookies = [csrfCookie, signinCookie].filter(Boolean).join('; ');
    console.log('cookies', cookies);

    const sessionRes = await request('/api/auth/session', 'GET', null, {
      Cookie: cookies,
    });
    console.log('session status', sessionRes.status, sessionRes.body);

    const payRes = await request('/api/paystack/initialize', 'POST', JSON.stringify({
      pathwayId: 'Goethe exam mastery',
      pathwayName: 'Goethe exam mastery',
      amount: 90000,
      tuitionFee: 150000,
      depositPercent: 60,
      paymentStage: 'deposit',
    }), {
      'Content-Type': 'application/json',
      Cookie: cookies,
    });
    console.log('pay init status', payRes.status, payRes.body);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
