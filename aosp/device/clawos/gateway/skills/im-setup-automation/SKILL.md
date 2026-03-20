---
name: im-setup-automation
description: Automate end-to-end IM (Telegram, Discord, Slack, Feishu, DingTalk) bot setup — install app, guide login, create bot, extract token, write Gateway config. Use when the user says "帮我配置 Telegram/Discord/Slack/飞书/钉钉" or clicks the "AI 自动配置" button in the IM wizard.
metadata:
  {
    "openclaw":
      {
        "emoji": "🤖",
        "tags": ["im", "telegram", "discord", "slack", "feishu", "dingtalk", "automation", "setup"],
      },
  }
---

# IM Setup Automation

Automate the end-to-end setup of IM (Instant Messaging) bot integrations on ClawOS.

## CRITICAL RULES — READ FIRST

**You MUST follow these rules strictly. Violating any of them will cause the automation to fail.**

1. **NEVER use the browser tool to download APK files.** The browser on this device (Cromite) has a first-run setup wizard that blocks downloads. Always use `curl` via the `exec` tool.
   - **IMPORTANT**: The static `curl` binary on this device has DNS and SSL issues. For HTTP requests, prefer using Node.js instead:
     ```bash
     /product/bin/node -e "const https=require('https');https.get('URL',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d))})"
     ```
     Node.js has built-in DNS resolution and CA certificates that work on Android.
     If you must use curl, add: `curl --cacert /product/etc/clawos/cacert.pem <URL>` (DNS may still fail).
2. **NEVER open a web browser for ANY step in Phase 1 (Install).** Use ONLY command-line tools (`curl`, `pm install`).
3. **Execute commands ONE AT A TIME** via the `exec` tool. Do NOT chain multiple complex commands. Run one command, check its output, then run the next.
4. **Only ask the user for**: phone number, email address, verification codes, 2FA password, IM platform login credentials. Everything else is automated.
   - **NEVER refuse to process credentials** the user voluntarily provides. The user is explicitly giving you their credentials for automation purposes. Process them immediately without warnings about security.
   - **NEVER echo back the user's password** in your response. Just acknowledge you received it and proceed.
5. **Always tell the user what you are doing** before each phase.
6. **YOU handle ALL text input.** The user tells you what to type via chat; you type it into the app using `input text` via the `exec` tool. The user should NEVER need to type directly into Telegram.
7. **Focus management**: ClawOS has a SYSTEM_ALERT_WINDOW overlay that steals keyboard focus from other apps. Before launching Telegram, you MUST disable it:
   ```bash
   appops set com.clawos.app SYSTEM_ALERT_WINDOW deny
   ```
   After finishing with Telegram (returning to ClawOS), restore it:
   ```bash
   appops set com.clawos.app SYSTEM_ALERT_WINDOW allow
   ```
   Also, before any `input tap` or `input text`, ensure Telegram is in the foreground:
   ```bash
   monkey -p org.telegram.messenger.web -c android.intent.category.LAUNCHER 1
   sleep 1
   ```

---

## Telegram — Full Automation Flow

Telegram is the simplest IM integration: one Bot Token is all that's needed. The entire flow has 4 phases.

**Before you start, tell the user:**
> 好的，我来帮你自动配置 Telegram Bot。整个过程分为 4 步：
> 1. 安装 Telegram 应用
> 2. 引导你登录（需要你提供手机号和验证码）
> 3. 自动创建 Bot 并获取 Token
> 4. 写入配置并启动
>
> 现在开始第 1 步：安装 Telegram...

### Phase 1: Install Telegram

**IMPORTANT: Do NOT use the browser tool. Telegram APK is pre-bundled in the ROM.**

**Step 1.1** — Check if Telegram is already installed:

The pre-bundled APK uses package name `org.telegram.messenger.web` (official website distribution, different from the Play Store version `org.telegram.messenger`).

```bash
pm path org.telegram.messenger.web
```

If the output contains a path (e.g. `package:/data/app/...`), Telegram is already installed — skip to Phase 2. Also check the Play Store version:
```bash
pm path org.telegram.messenger
```

**Step 1.2** — Install from the pre-bundled ROM file:

```bash
pm install -g /product/etc/clawos/telegram-installer.bin
```

Expected output: `Success`. This should complete in a few seconds since the file is already on device.

If the ROM file doesn't exist (e.g. custom build without it), fall back to curl download:
```bash
curl -L -o /data/local/tmp/telegram.apk "https://telegram.org/dl/android/apk" && pm install -g /data/local/tmp/telegram.apk && rm /data/local/tmp/telegram.apk
```

**Step 1.3** — Verify installation:

```bash
pm path org.telegram.messenger.web
```

This should now return a path, confirming installation succeeded.

**Tell the user:** "Telegram 已安装成功，现在开始第 2 步：登录..."

### Phase 2: Login (requires user input)

**IMPORTANT**: The user should LOGIN with their EXISTING Telegram account, NOT register a new one. Telegram registration from emulator IPs may require payment. The user already has a Telegram account on their phone — we just need to log into it on this device.

**Step 2.1** — Disable ClawOS overlay and launch Telegram:

ClawOS has SYSTEM_ALERT_WINDOW permission which causes its overlay to steal keyboard focus from other apps. You MUST disable it before interacting with Telegram:

```bash
appops set com.clawos.app SYSTEM_ALERT_WINDOW deny
```

Now launch Telegram (use the `.web` package for the website-distributed version):

```bash
monkey -p org.telegram.messenger.web -c android.intent.category.LAUNCHER 1
```

If that fails (package not found), try the Play Store version:
```bash
monkey -p org.telegram.messenger -c android.intent.category.LAUNCHER 1
```

Wait 4 seconds for the app to start and gain focus:

```bash
sleep 4
```

**IMPORTANT**: If at any point during Phase 2 or Phase 3 the UI dump shows ClawOS elements instead of Telegram, bring Telegram back to the foreground:
```bash
monkey -p org.telegram.messenger.web -c android.intent.category.LAUNCHER 1
sleep 2
```

**Step 2.2** — Capture the screen and detect the current state:

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

Analyze the XML output to determine the current state:
- If you find `text="Start Messaging"` or `text="开始使用"` → Tap that button, then dump UI again
- If you find a phone number input field (`class="android.widget.EditText"`) → Proceed to step 2.3
- If you find a chat list or contacts → User is already logged in, skip to Phase 3

To tap a button: parse its `bounds="[left,top][right,bottom]"`, calculate the center point `X=(left+right)/2, Y=(top+bottom)/2`, then:

```bash
input tap X Y
sleep 2
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

**Step 2.3** — Ask the user for their phone number:

**ASK THE USER**: "请提供您的 Telegram 手机号码（含国家码，例如 +86 13800138000）"

After receiving the phone number (e.g., `+86 13800138000`):

1. Dump UI to locate input fields
2. The country code might need changing. If the default isn't the user's country, tap the country selector, search for the right country, and select it
3. Tap the phone number EditText field to focus it
4. Type the phone number digits (without country code prefix):
   ```bash
   input tap <phone_field_X> <phone_field_Y>
   sleep 0.5
   input text "13800138000"
   sleep 1
   ```
5. Find and tap the forward/next arrow button (usually top-right or bottom-right, often a checkmark or arrow icon)
6. If a confirmation dialog appears ("Is this the correct number?"), tap the confirm/OK button
7. Dump UI to check what screen comes next

**Step 2.4** — Handle email verification (if required):

**Recent Telegram versions require email verification before SMS.** After submitting the phone number, dump UI:

```bash
sleep 2
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

If the screen asks for an email address (look for text like "Email", "email", "邮箱", or an EditText with hint about email):

**ASK THE USER**: "Telegram 需要邮箱验证。请提供您的邮箱地址。"

After receiving the email, type it using `input text` via the `exec` tool:

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
# Tap the email input field to focus it
input tap <email_field_X> <email_field_Y>
sleep 0.5
# Type the email address
input text "user@example.com"
sleep 0.5
```

Then tap the next/submit button. After submitting, dump UI:

```bash
sleep 2
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

If Telegram shows an email verification code screen:

**ASK THE USER**: "请检查您的邮箱，输入收到的验证码（通常是 6 位数字）。"

After receiving the email code:
```bash
input tap <code_field_X> <code_field_Y>
sleep 0.3
input text "<email_verification_code>"
sleep 3
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

**Step 2.5** — Handle SMS Fee screen (if it appears):

After email verification, Telegram may show an "SMS Fee" screen (especially for Chinese phone numbers +86). Dump UI:

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

If you see text like "SMS Fee", "High SMS Costs", or "Sign up for CN¥" in the XML — this means Telegram wants payment to cover SMS delivery costs. **Do NOT automatically pay.** Instead:

1. The verification code was likely already sent to the user's existing Telegram app on their phone (not via SMS).
2. Look for a three-dot menu (⋮) at the top-right for alternative verification options.
3. The user can also press Back to try a different verification method.

**ASK THE USER**: "Telegram 显示了短信费用页面（CN¥7.25）。请先检查你手机上的 Telegram 应用，登录验证码可能已经发送到那里了（不走短信）。如果收到了验证码请告诉我；如果没有，你可以选择支付 CN¥7.25 通过短信接收。"

If the user provides a code they received on their phone, press Back on this screen to return to the code entry screen, then enter the code.

If the user chooses to pay, tap the "Sign up" button and wait for the payment to complete, then the code should arrive via SMS.

**Step 2.6** — Enter verification code:

Once the SMS Fee screen is resolved, dump UI to find the code entry field:

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

If not yet on the code entry screen, navigate to it (press Back from SMS Fee screen if needed).

**ASK THE USER** (if code not already provided): "请输入你收到的 Telegram 验证码（5-6 位数字）。"

After receiving the code:

```bash
input tap <code_field_X> <code_field_Y>
sleep 0.3
input text "<code>"
sleep 3
```

Telegram usually auto-submits after all digits are entered. Dump UI to check:
```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

**Step 2.7** — Handle post-login screens:

Check the UI after login. Possible screens:
- **Cloud password (2FA)**: ASK THE USER for their 2FA password
- **Profile setup / permission requests**: Dismiss by tapping "Skip", "Not Now", or pressing Back
- **Chat list visible**: Login complete! Proceed to Phase 3

**Tell the user:** "登录成功！现在开始第 3 步：自动创建 Bot..."

### Phase 3: Create Bot via BotFather (fully automated)

This phase requires NO user input.

**Step 3.1** — Open BotFather:

Dump UI to find the search button/icon (magnifying glass, usually top-right):
```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

Tap the search field and type "BotFather":
```bash
input tap <search_X> <search_Y>
sleep 1
input text "BotFather"
sleep 2
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

Find "BotFather" in the results (verified bot) and tap it:
```bash
input tap <botfather_X> <botfather_Y>
sleep 2
```

If BotFather chat shows a "START" button at the bottom, tap it first:
```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
# If START button found:
input tap <start_X> <start_Y>
sleep 2
```

**Step 3.2** — Send /newbot command:

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

Find the message input field at the bottom of the screen, tap it, type the command, and send:
```bash
input tap <input_X> <input_Y>
sleep 0.5
input text "/newbot"
sleep 0.5
```

Find and tap the Send button (arrow icon, appears after typing):
```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
input tap <send_X> <send_Y>
sleep 3
```

**Step 3.3** — Send bot display name:

Dump UI to verify BotFather responded. Then send the display name:
```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
input tap <input_X> <input_Y>
sleep 0.3
input text "ClawOS Assistant"
sleep 0.5
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
input tap <send_X> <send_Y>
sleep 3
```

**Step 3.4** — Send bot username:

BotFather asks for a username (must end with `bot`). First, generate a unique username using the current timestamp:
```bash
date +%s
```

Use the output (e.g., `1710000000`) to create a username like `clawos_1710000000_bot`. Then send it:
```bash
input tap <input_X> <input_Y>
sleep 0.3
input text "clawos_TIMESTAMP_bot"
sleep 0.5
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
input tap <send_X> <send_Y>
sleep 3
```

If BotFather says the username is taken, try with a random 4-digit suffix:
```bash
shuf -i 1000-9999 -n 1
```

**Step 3.5** — Extract the Bot Token:

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

Search the XML output for text that contains the token. The token format is: `NUMBERS:ALPHANUMERIC_STRING` (e.g., `7123456789:AAH5Kx3B_example_token_text`).

Look for a `text` attribute in the XML that contains this pattern. BotFather's message will say something like:
> "Use this token to access the HTTP API: 7123456789:AAH5Kx3..."

If the token text is not visible (might be cut off or scrolled away), scroll down:
```bash
input swipe 500 1500 500 500 300
sleep 1
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

Extract the token string carefully — it is the ENTIRE string in the format `digits:alphanumeric`.

**Step 3.6** — Return to ClawOS and restore overlay:

```bash
input keyevent KEYCODE_HOME
sleep 1
# Restore ClawOS overlay permission
appops set com.clawos.app SYSTEM_ALERT_WINDOW allow
```

**Tell the user:** "Bot 创建成功！正在验证 Token 并写入配置..."

### Phase 4: Configure Gateway (fully automated)

**Step 4.1** — Verify the token works:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```

Replace `<TOKEN>` with the actual token. The response should contain `"ok":true` and the bot's username. If not, the token is wrong — re-check Phase 3.

**Step 4.2** — Write Telegram config to Gateway:

```bash
cat /data/local/tmp/clawos/openclaw.json
```

Read the current config, then use jq to add the Telegram channel:

```bash
cp /data/local/tmp/clawos/openclaw.json /data/local/tmp/clawos/openclaw.json.bak

cat /data/local/tmp/clawos/openclaw.json | /product/bin/jq --arg token "THE_ACTUAL_TOKEN" '.channels.telegram = {
  "enabled": true,
  "botToken": $token,
  "dmPolicy": "pairing",
  "groups": { "*": { "requireMention": true } }
}' > /data/local/tmp/clawos/openclaw.json.tmp && mv /data/local/tmp/clawos/openclaw.json.tmp /data/local/tmp/clawos/openclaw.json
```

**Step 4.3** — Restart Gateway:

```bash
setprop ctl.restart clawos_gateway
sleep 5
```

**Step 4.4** — Report completion to the user:

> ✅ Telegram Bot 配置完成！
>
> - Bot 名称: ClawOS Assistant
> - Bot 用户名: @clawos_XXXX_bot
> - Token 已验证并写入 Gateway 配置
> - Gateway 已重启
>
> 你现在可以在 Telegram 中搜索你的 Bot 并发消息，ClawOS 会自动回复。

---

## Discord — Bot Setup Flow

Discord bot creation is done through the Discord Developer Portal (web). This flow uses **browser automation** — the AI opens Cromite browser, logs into Discord, and creates the bot automatically. The user only needs to provide their Discord credentials.

**Before you start, tell the user:**
> 好的，我来帮你自动配置 Discord Bot。整个过程分为 4 步：
> 1. 获取你的 Discord 登录信息
> 2. 通过浏览器自动登录开发者平台并创建 Bot
> 3. 将 Bot 邀请到你的服务器
> 4. 写入 Gateway 配置
>
> 首先需要你提供 Discord 账号信息。

### Phase 1: Guide User to Create Discord Bot

Discord requires CAPTCHA for all API login attempts, so bot creation must be done manually by the user. Guide them clearly:

First, detect whether the device is an emulator or a real device:

```bash
IS_EMULATOR=$(getprop ro.hardware)
```

**If `IS_EMULATOR` is `ranchu` or `goldfish`** (emulator): hCaptcha cannot work. Guide the user to operate on their phone or computer:

> 检测到当前运行在**模拟器**环境中，Discord 的人机验证（hCaptcha）在模拟器中无法完成。
> 请在你的**手机或电脑**上打开浏览器，访问以下地址：
>
> **https://discord.com/developers/applications**
>
> 登录后按以下步骤操作（大约 2 分钟）：
>
> **1. 创建应用**
> 点击右上角 "New Application" → 输入名称 `ClawOS Bot` → 勾选同意条款 → 点击 "Create"
>
> **2. 创建 Bot 并获取 Token**
> 左侧菜单点击 "Bot" → 点击 "Reset Token" → 确认 → **复制显示的 Token**
>
> **3. 启用权限**
> 在同一页面向下滚动到 "Privileged Gateway Intents"，打开这三个开关：
> - Presence Intent
> - Server Members Intent
> - Message Content Intent
> 然后点击 "Save Changes"
>
> **4. 把 Bot Token 发给我**（直接粘贴到这里的聊天框）

**If `IS_EMULATOR` is NOT `ranchu` or `goldfish`** (real device): open the browser directly on the device:

```bash
appops set com.clawos.app SYSTEM_ALERT_WINDOW deny
sleep 1
am start -a android.intent.action.VIEW -d "https://discord.com/developers/applications"
```

Then tell the user:

> 我已在设备上打开了 Discord 开发者平台。请按以下步骤操作（大约 2 分钟）：
>
> **1. 登录 Discord**（如果还没登录）
>
> **2. 创建应用**
> 点击右上角 "New Application" → 输入名称 `ClawOS Bot` → 勾选同意条款 → 点击 "Create"
>
> **3. 创建 Bot 并获取 Token**
> 左侧菜单点击 "Bot" → 点击 "Reset Token" → 确认 → **复制显示的 Token**
>
> **4. 启用权限**
> 在同一页面向下滚动到 "Privileged Gateway Intents"，打开这三个开关：
> - Presence Intent
> - Server Members Intent
> - Message Content Intent
> 然后点击 "Save Changes"
>
> **5. 把 Bot Token 发给我**（直接粘贴到聊天框）

Wait for the user to provide the Bot Token.

### Phase 2: Verify Token and Invite Bot

After receiving the Bot Token from the user, if the device is a real device (not emulator), restore the overlay and go home:

```bash
IS_EMULATOR=$(getprop ro.hardware)
if [ "$IS_EMULATOR" != "ranchu" ] && [ "$IS_EMULATOR" != "goldfish" ]; then
    appops set com.clawos.app SYSTEM_ALERT_WINDOW allow
    input keyevent KEYCODE_HOME
fi
```

Then proceed to verify and configure:

**Step 2.1** — Verify the token using Node.js (curl has DNS issues on this device):

```bash
/product/bin/node -e "const https=require('https');const opts={hostname:'discord.com',path:'/api/v10/users/@me',headers:{'Authorization':'Bot BOT_TOKEN'}};https.get(opts,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))})"
```

Replace `BOT_TOKEN` with the actual token. Check that the response status is `200` and contains `"id"` and `"username"`.

Extract the bot's Application ID from the `"id"` field in the response.

If verification fails, ask the user to double-check their token.

**Step 2.2** — Generate and share the invite link:

Use the bot's ID to build the invite URL:

```
https://discord.com/api/oauth2/authorize?client_id=BOT_ID&permissions=274877975552&scope=bot
```

**Tell the user**: "Bot Token 验证成功！请在手机或电脑浏览器中打开以下链接，将 Bot 添加到你的 Discord 服务器：\n\n`https://discord.com/api/oauth2/authorize?client_id=BOT_ID&permissions=274877975552&scope=bot`\n\n选择你的服务器，然后点击 Authorize。完成后告诉我。"

Wait for the user to confirm.

### Phase 3: Configure Gateway

**Step 3.1** — Write Discord config:

```bash
cat /data/local/tmp/clawos/openclaw.json
```

```bash
cp /data/local/tmp/clawos/openclaw.json /data/local/tmp/clawos/openclaw.json.bak

cat /data/local/tmp/clawos/openclaw.json | /product/bin/jq --arg token "THE_ACTUAL_TOKEN" '.channels.discord = {
  "enabled": true,
  "botToken": $token,
  "dmPolicy": "pairing",
  "guilds": { "*": { "requireMention": true } }
}' > /data/local/tmp/clawos/openclaw.json.tmp && mv /data/local/tmp/clawos/openclaw.json.tmp /data/local/tmp/clawos/openclaw.json
```

**Step 3.2** — Restart Gateway:

```bash
setprop ctl.restart clawos_gateway
sleep 5
```

**Step 3.3** — Report completion:

> ✅ Discord Bot 配置完成！
>
> - Bot 名称: ClawOS Bot
> - Token 已验证并写入 Gateway 配置
> - Gateway 已重启
>
> 你现在可以在 Discord 服务器中 @ClawOS Bot 发消息，ClawOS 会自动回复。
> 如果是私聊，直接发消息给 Bot 即可。

---

## Slack — Bot Setup Flow

Slack requires creating an App on the Slack API console, enabling Socket Mode, and obtaining two tokens: a Bot Token (`xoxb-...`) and an App Token (`xapp-...`). This flow uses **guided instructions** — the AI guides the user step by step.

**Before you start, tell the user:**
> 好的，我来帮你自动配置 Slack Bot。整个过程分为 3 步：
> 1. 在 Slack 开发者平台创建 App 并获取 Token
> 2. 验证 Token
> 3. 写入 Gateway 配置
>
> 现在开始第 1 步。

### Phase 1: Guide User to Create Slack App

First, detect whether the device is an emulator or a real device:

```bash
IS_EMULATOR=$(getprop ro.hardware)
```

**If `IS_EMULATOR` is `ranchu` or `goldfish`** (emulator): guide the user to operate on their phone or computer:

> 请在你的**手机或电脑**上打开浏览器，访问：
>
> **https://api.slack.com/apps**
>
> 登录后按以下步骤操作（大约 5 分钟）：
>
> **1. 创建 App**
> 点击 "Create New App" → 选择 "From scratch" → 输入名称 `ClawOS Bot` → 选择你的 Workspace → 点击 "Create App"
>
> **2. 启用 Socket Mode**
> 左侧菜单点击 "Socket Mode" → 打开 "Enable Socket Mode" 开关 → 在弹出的对话框中输入 Token 名称（如 `clawos-socket`）→ 点击 "Generate" → **复制生成的 App Token（以 `xapp-` 开头）**
>
> **3. 配置 Event Subscriptions**
> 左侧菜单点击 "Event Subscriptions" → 打开 "Enable Events" 开关 → 在 "Subscribe to bot events" 中点击 "Add Bot User Event" → 添加以下事件：
> - `message.im`
> - `message.channels`
> - `message.groups`
> - `message.mpim`
> - `app_mention`
> 然后点击 "Save Changes"
>
> **4. 配置 App Home**
> 左侧菜单点击 "App Home" → 确保 "Messages Tab" 已启用（Allow users to send Slash commands and messages from the messages tab）
>
> **5. 安装到 Workspace**
> 左侧菜单点击 "OAuth & Permissions" → 点击 "Install to Workspace" → 授权 → **复制 "Bot User OAuth Token"（以 `xoxb-` 开头）**
>
> **6. 把两个 Token 发给我**
> - App Token（`xapp-` 开头）
> - Bot Token（`xoxb-` 开头）

**If `IS_EMULATOR` is NOT `ranchu` or `goldfish`** (real device): open the browser directly:

```bash
appops set com.clawos.app SYSTEM_ALERT_WINDOW deny
sleep 1
am start -a android.intent.action.VIEW -d "https://api.slack.com/apps"
```

Then provide the same step-by-step instructions as above, telling the user to complete them in the browser, and paste both tokens back.

Wait for the user to provide both tokens.

### Phase 2: Verify Tokens and Configure

After receiving both tokens, if on a real device, restore the overlay:

```bash
IS_EMULATOR=$(getprop ro.hardware)
if [ "$IS_EMULATOR" != "ranchu" ] && [ "$IS_EMULATOR" != "goldfish" ]; then
    appops set com.clawos.app SYSTEM_ALERT_WINDOW allow
    input keyevent KEYCODE_HOME
fi
```

**Step 2.1** — Verify the Bot Token using Node.js:

```bash
/product/bin/node -e "const https=require('https');const opts={hostname:'slack.com',path:'/api/auth.test',method:'POST',headers:{'Authorization':'Bearer BOT_TOKEN','Content-Type':'application/x-www-form-urlencoded'}};const req=https.request(opts,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))});req.end()"
```

Replace `BOT_TOKEN` with the actual `xoxb-...` token. Check that the response contains `"ok":true`.

If verification fails, ask the user to double-check the token.

**Step 2.2** — Validate the App Token format:

The App Token should start with `xapp-`. Just verify the prefix; Slack does not have a direct API to validate app-level tokens.

```bash
echo "APP_TOKEN" | grep -q "^xapp-" && echo "Format OK" || echo "Format INVALID"
```

### Phase 3: Configure Gateway

**Step 3.1** — Write Slack config:

```bash
cat /data/local/tmp/clawos/openclaw.json
```

```bash
cp /data/local/tmp/clawos/openclaw.json /data/local/tmp/clawos/openclaw.json.bak

cat /data/local/tmp/clawos/openclaw.json | /product/bin/jq --arg bot "THE_BOT_TOKEN" --arg app "THE_APP_TOKEN" '.channels.slack = {
  "enabled": true,
  "botToken": $bot,
  "appToken": $app,
  "dmPolicy": "pairing"
}' > /data/local/tmp/clawos/openclaw.json.tmp && mv /data/local/tmp/clawos/openclaw.json.tmp /data/local/tmp/clawos/openclaw.json
```

**Step 3.2** — Restart Gateway:

```bash
setprop ctl.restart clawos_gateway
sleep 5
```

**Step 3.3** — Report completion:

> Slack Bot 配置完成！
>
> - Bot Token 和 App Token 已验证并写入 Gateway 配置
> - 连接模式: Socket Mode（无需公网 URL）
> - Gateway 已重启
>
> 你现在可以在 Slack 中给 Bot 发私信，或在频道中 @ClawOS Bot，ClawOS 会自动回复。

---

## 飞书 / Lark — Bot Setup Flow

飞书机器人创建需要在飞书开放平台操作。使用**引导式**方案 — AI 指导用户在浏览器中完成所有步骤。

**Before you start, tell the user:**
> 好的，我来帮你自动配置飞书机器人。整个过程分为 3 步：
> 1. 在飞书开放平台创建应用并获取凭据
> 2. 验证凭据
> 3. 写入 Gateway 配置
>
> 现在开始第 1 步。

### Phase 1: Guide User to Create Feishu App

First, detect environment:

```bash
IS_EMULATOR=$(getprop ro.hardware)
```

**If `IS_EMULATOR` is `ranchu` or `goldfish`** (emulator): guide the user on phone/computer:

> 请在你的**手机或电脑**上打开浏览器，访问：
>
> **https://open.feishu.cn/app**
>
> 如果你使用的是 Lark（国际版），请访问 https://open.larksuite.com/app
>
> 登录后按以下步骤操作（大约 5 分钟）：
>
> **1. 创建应用**
> 点击 "创建企业自建应用" → 输入应用名称（如 `ClawOS Bot`）→ 输入描述 → 点击 "创建"
>
> **2. 复制凭据**
> 在 "凭证与基础信息" 页面中，**复制 App ID（以 `cli_` 开头）和 App Secret**
>
> **3. 配置权限**
> 点击 "权限管理" → 点击 "批量开通" → 粘贴以下 JSON 并确认：
> ```json
> {"scopes":{"tenant":["im:message","im:message:send_as_bot","im:message.p2p_msg:readonly","im:message.group_at_msg:readonly","im:message:readonly","im:chat.members:bot_access","im:resource","im:chat.access_event.bot_p2p_chat:read"]}}
> ```
>
> **4. 添加机器人能力**
> 点击 "应用能力" → "机器人" → 启用机器人
>
> **5. 配置事件订阅**
> 点击 "事件与回调" → 选择 "使用长连接接收事件"（WebSocket 模式）→ 添加事件 `im.message.receive_v1`
>
> **注意**: 确保 Gateway 正在运行后再配置事件订阅，否则长连接可能无法保存。
>
> **6. 发布应用**
> 点击 "版本管理与发布" → "创建版本" → 提交审核
>
> **7. 把凭据发给我**
> - App ID（`cli_` 开头）
> - App Secret

**If on real device**: open browser directly:

```bash
appops set com.clawos.app SYSTEM_ALERT_WINDOW deny
sleep 1
am start -a android.intent.action.VIEW -d "https://open.feishu.cn/app"
```

Then provide the same instructions and wait for the user to provide App ID and App Secret.

### Phase 2: Verify Credentials

After receiving credentials, restore overlay if on real device:

```bash
IS_EMULATOR=$(getprop ro.hardware)
if [ "$IS_EMULATOR" != "ranchu" ] && [ "$IS_EMULATOR" != "goldfish" ]; then
    appops set com.clawos.app SYSTEM_ALERT_WINDOW allow
    input keyevent KEYCODE_HOME
fi
```

**Step 2.1** — Verify credentials using the tenant_access_token API:

```bash
/product/bin/node -e "const https=require('https');const data=JSON.stringify({app_id:'APP_ID',app_secret:'APP_SECRET'});const opts={hostname:'open.feishu.cn',path:'/open-apis/auth/v3/tenant_access_token/internal/',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}};const req=https.request(opts,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))});req.write(data);req.end()"
```

Replace `APP_ID` and `APP_SECRET` with actual values. The response should contain `"code":0`.

If verification fails, ask the user to double-check the credentials.

### Phase 3: Configure Gateway

**Step 3.1** — Write Feishu config:

```bash
cat /data/local/tmp/clawos/openclaw.json
```

```bash
cp /data/local/tmp/clawos/openclaw.json /data/local/tmp/clawos/openclaw.json.bak

cat /data/local/tmp/clawos/openclaw.json | /product/bin/jq --arg appId "THE_APP_ID" --arg appSecret "THE_APP_SECRET" '.channels.feishu = {
  "enabled": true,
  "dmPolicy": "pairing",
  "accounts": {
    "main": {
      "appId": $appId,
      "appSecret": $appSecret
    }
  }
}' > /data/local/tmp/clawos/openclaw.json.tmp && mv /data/local/tmp/clawos/openclaw.json.tmp /data/local/tmp/clawos/openclaw.json
```

**Step 3.2** — Restart Gateway:

```bash
setprop ctl.restart clawos_gateway
sleep 5
```

**Step 3.3** — Report completion:

> 飞书机器人配置完成！
>
> - App ID 和 App Secret 已验证并写入 Gateway 配置
> - 连接模式: WebSocket 长连接（无需公网 URL）
> - Gateway 已重启
>
> 你现在可以在飞书中找到你的 Bot 并发送消息。首次发消息时会收到配对码，你可以告诉我配对码，我帮你批准。

---

## 钉钉 (DingTalk) — Bot Setup Flow

钉钉机器人创建需要在钉钉开放平台操作。使用**引导式**方案。

**Before you start, tell the user:**
> 好的，我来帮你自动配置钉钉机器人。整个过程分为 3 步：
> 1. 在钉钉开放平台创建应用并获取凭据
> 2. 验证凭据
> 3. 写入 Gateway 配置
>
> 现在开始第 1 步。

### Phase 1: Guide User to Create DingTalk App

First, detect environment:

```bash
IS_EMULATOR=$(getprop ro.hardware)
```

**If `IS_EMULATOR` is `ranchu` or `goldfish`** (emulator): guide the user on phone/computer:

> 请在你的**手机或电脑**上打开浏览器，访问：
>
> **https://open.dingtalk.com/**
>
> 登录后按以下步骤操作（大约 5 分钟）：
>
> **1. 创建应用**
> 点击 "应用开发" → "企业内部开发" → "创建应用" → 输入应用名称（如 `ClawOS Bot`）→ 输入描述 → 点击 "确定创建"
>
> **2. 复制凭据**
> 在 "凭证与基础信息" 页面中，**复制 Client ID（以 `ding` 开头）和 Client Secret**
>
> **3. 添加机器人能力**
> 点击 "应用能力" → "机器人" → "配置" → 启用机器人 → 输入机器人名称
>
> **4. 配置权限**
> 点击 "权限管理" → 搜索并添加以下权限：
> - 企业内机器人发送消息
> - 读取群消息
> - 获取用户基础信息
>
> **5. 发布应用**
> 点击 "版本管理与发布" → "创建版本" → 提交发布
>
> **6. 把凭据发给我**
> - Client ID（`ding` 开头）
> - Client Secret

**If on real device**: open browser directly:

```bash
appops set com.clawos.app SYSTEM_ALERT_WINDOW deny
sleep 1
am start -a android.intent.action.VIEW -d "https://open.dingtalk.com/"
```

Then provide the same instructions and wait for credentials.

### Phase 2: Verify Credentials

After receiving credentials, restore overlay if on real device:

```bash
IS_EMULATOR=$(getprop ro.hardware)
if [ "$IS_EMULATOR" != "ranchu" ] && [ "$IS_EMULATOR" != "goldfish" ]; then
    appops set com.clawos.app SYSTEM_ALERT_WINDOW allow
    input keyevent KEYCODE_HOME
fi
```

**Step 2.1** — Verify credentials using the accessToken API:

```bash
/product/bin/node -e "const https=require('https');const data=JSON.stringify({appKey:'CLIENT_ID',appSecret:'CLIENT_SECRET'});const opts={hostname:'api.dingtalk.com',path:'/v1.0/oauth2/accessToken',method:'POST',headers:{'Content-Type':'application/json','Content-Length':data.length}};const req=https.request(opts,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d))});req.write(data);req.end()"
```

Replace `CLIENT_ID` and `CLIENT_SECRET` with actual values. The response should contain `"accessToken"`.

If verification fails, ask the user to double-check the credentials.

### Phase 3: Configure Gateway

**Step 3.1** — Install DingTalk plugin (if not already installed):

```bash
# Check if plugin exists in Gateway's extensions directory
ls /data/local/tmp/clawos/.openclaw/extensions/dingtalk/package.json 2>/dev/null
```

If the plugin is not installed, copy from ROM:

```bash
mkdir -p /data/local/tmp/clawos/.openclaw/extensions/dingtalk
cp -r /product/etc/clawos/extensions/dingtalk/* /data/local/tmp/clawos/.openclaw/extensions/dingtalk/
chmod -R 755 /data/local/tmp/clawos/.openclaw/extensions/dingtalk/
```

Enable the plugin in config:

```bash
cat /data/local/tmp/clawos/openclaw.json | /product/bin/jq '.plugins.entries.dingtalk = {"enabled": true}' > /data/local/tmp/clawos/openclaw.json.tmp && mv /data/local/tmp/clawos/openclaw.json.tmp /data/local/tmp/clawos/openclaw.json
```

**Step 3.2** — Write DingTalk channel config:

```bash
cat /data/local/tmp/clawos/openclaw.json
```

```bash
cp /data/local/tmp/clawos/openclaw.json /data/local/tmp/clawos/openclaw.json.bak

cat /data/local/tmp/clawos/openclaw.json | /product/bin/jq --arg cid "THE_CLIENT_ID" --arg cs "THE_CLIENT_SECRET" '.channels.dingtalk = {
  "enabled": true,
  "clientId": $cid,
  "clientSecret": $cs,
  "dmPolicy": "pairing"
}' > /data/local/tmp/clawos/openclaw.json.tmp && mv /data/local/tmp/clawos/openclaw.json.tmp /data/local/tmp/clawos/openclaw.json
```

**Step 3.3** — Restart Gateway:

```bash
setprop ctl.restart clawos_gateway
sleep 5
```

**Step 3.4** — Report completion:

> 钉钉机器人配置完成！
>
> - Client ID 和 Client Secret 已验证并写入 Gateway 配置
> - 连接模式: Stream（无需公网 URL）
> - Gateway 已重启
>
> 你现在可以在钉钉中找到你的 Bot 并发送消息，ClawOS 会自动回复。

---

## Error Recovery

| Problem | Solution |
|---------|----------|
| `curl` download hangs or fails | Check network: `ping -c 2 8.8.8.8`. If proxy needed, try `curl --proxy http://proxy:port`. If still fails, ask user to manually download APK. |
| `pm install` returns `Failure` | Check disk space: `df /data`. If `INSTALL_FAILED_INSUFFICIENT_STORAGE`, free space. If signature error, try `pm install -r`. |
| `uiautomator dump` returns empty/error | Screen might be off: `input keyevent KEYCODE_WAKEUP`. Or an overlay: `input keyevent KEYCODE_BACK`. |
| Can't find UI element | Take screenshot: `screencap -p /sdcard/debug.png`. Then look at the screenshot to understand what's on screen. Try scrolling or pressing back. |
| Token not visible in BotFather chat | Scroll down/up in chat: `input swipe 500 1500 500 500 300`. If still not found, ask user to manually copy the token from BotFather. |
| `input text` produces wrong characters | Try typing character by character. For spaces, use `input keyevent KEYCODE_SPACE`. |
| Country code wrong in Telegram | Default country depends on SIM/locale. On emulator with no SIM, it may default to US (+1). Tap the country selector and search for the correct country. |

### Fallback: Manual Token Entry

If bot creation automation fails, fall back gracefully:

1. Tell the user: "自动创建 Bot 遇到了问题，我来引导你手动操作"
2. Ask the user to open the BotFather chat in Telegram, send /newbot, follow the prompts
3. Ask the user to paste the Bot Token they receive
4. Continue from Phase 4 (config writing) with the manually provided token

---

## Tips for UI Automation

- **Always dump UI before interacting**: Never assume element positions. Always `uiautomator dump` first.
- **Calculate tap coordinates from bounds**: Parse `bounds="[left,top][right,bottom]"`, tap at center `((left+right)/2, (top+bottom)/2)`.
- **Sleep between actions**: Always wait 1-3 seconds after tapping, typing, or launching apps before dumping UI again.
- **`input text` limitations**: Only works reliably with ASCII. For CJK characters, write to a file and use clipboard. On this device, spaces can be problematic — use `input keyevent KEYCODE_SPACE` instead.
- **Verify after every action**: After tapping or typing, dump UI again to confirm the expected state change happened.
- **Telegram send button**: Only appears when message input has text. After `input text`, dump UI to find the send button.
