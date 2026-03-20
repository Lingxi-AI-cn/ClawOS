#!/product/bin/node
// Discord Bot Auto-Setup Script (Node.js)
// Usage: node discord-bot-setup.mjs <email> <password>
// Output: JSON with bot_token, app_id, invite_url on success

import https from 'node:https'

const API = 'https://discord.com/api/v9'
const UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/91.0.4472.114'

function request(method, path, body, authToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API)
    const data = body ? JSON.stringify(body) : null
    const headers = {
      'User-Agent': UA,
      'Content-Type': 'application/json',
    }
    if (authToken) headers['Authorization'] = authToken

    const req = https.request(url, { method, headers }, (res) => {
      let chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, data: raw }) }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')) })
    if (data) req.write(data)
    req.end()
  })
}

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]

  if (!email || !password) {
    console.log(JSON.stringify({ error: 'Usage: node discord-bot-setup.mjs <email> <password>' }))
    process.exit(1)
  }

  // Step 1: Login
  process.stderr.write('STEP: Logging in...\n')
  let loginResp
  try {
    loginResp = await request('POST', '/auth/login', { login: email, password })
  } catch (e) {
    console.log(JSON.stringify({ error: 'network_error', message: e.message }))
    process.exit(1)
  }

  if (loginResp.data?.captcha_key) {
    console.log(JSON.stringify({
      error: 'captcha_required',
      message: 'Discord requires CAPTCHA. Please create bot manually at https://discord.com/developers/applications'
    }))
    process.exit(2)
  }

  if (loginResp.data?.mfa === true) {
    console.log(JSON.stringify({
      error: 'mfa_required',
      ticket: loginResp.data.ticket,
      message: 'Discord requires 2FA code.'
    }))
    process.exit(3)
  }

  const userToken = loginResp.data?.token
  if (!userToken) {
    console.log(JSON.stringify({ error: 'login_failed', response: loginResp.data }))
    process.exit(4)
  }
  process.stderr.write('STEP: Login successful\n')

  // Step 2: Create Application
  process.stderr.write('STEP: Creating application...\n')
  const appResp = await request('POST', '/applications', { name: 'ClawOS Bot' }, userToken)
  const appId = appResp.data?.id
  if (!appId) {
    console.log(JSON.stringify({ error: 'app_creation_failed', response: appResp.data }))
    process.exit(5)
  }
  process.stderr.write(`STEP: Application created: ${appId}\n`)

  // Step 3: Create Bot
  process.stderr.write('STEP: Creating bot...\n')
  const botResp = await request('POST', `/applications/${appId}/bot`, {}, userToken)
  const botToken = botResp.data?.token
  if (!botToken) {
    console.log(JSON.stringify({ error: 'bot_creation_failed', response: botResp.data }))
    process.exit(6)
  }
  process.stderr.write('STEP: Bot created\n')

  // Step 4: Enable privileged intents + make bot public
  process.stderr.write('STEP: Enabling intents...\n')
  await request('PATCH', `/applications/${appId}`, {
    bot_public: true,
    bot_require_code_grant: false,
    flags: 565248
  }, userToken)

  // Step 5: Verify
  process.stderr.write('STEP: Verifying bot...\n')
  const verifyResp = await request('GET', '/users/@me', null, `Bot ${botToken}`)
  const botUsername = verifyResp.data?.username || 'ClawOS Bot'

  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=274877975552&scope=bot`

  console.log(JSON.stringify({
    success: true,
    bot_token: botToken,
    app_id: appId,
    bot_username: botUsername,
    invite_url: inviteUrl
  }))
}

main().catch(e => {
  console.log(JSON.stringify({ error: 'unexpected', message: e.message }))
  process.exit(99)
})
