#!/system/bin/sh
# Discord Bot Auto-Setup Script
# Usage: sh /product/etc/clawos/discord-bot-setup.sh <email> <password>
# Output: JSON with bot_token, app_id, invite_url on success

set -e

EMAIL="$1"
PASSWORD="$2"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo '{"error":"Usage: discord-bot-setup.sh <email> <password>"}'
  exit 1
fi

API="https://discord.com/api/v9"
UA="Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/91.0.4472.114"

# CA cert configuration for static curl on Android
CACERT="/product/etc/clawos/cacert.pem"
CURL_EXTRA=""
if [ -f "$CACERT" ]; then
  export CURL_CA_BUNDLE="$CACERT"
  export SSL_CERT_FILE="$CACERT"
  CURL_EXTRA="--cacert $CACERT"
fi

log() { echo "STEP: $1" >&2; }

# Step 1: Login
log "Logging in..."
LOGIN_RESP=$(curl -s $CURL_EXTRA -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $UA" \
  -d "{\"login\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

# Check for captcha
if echo "$LOGIN_RESP" | grep -q "captcha"; then
  echo '{"error":"captcha_required","message":"Discord requires CAPTCHA verification. Please create the bot manually at https://discord.com/developers/applications"}'
  exit 2
fi

# Check for MFA
if echo "$LOGIN_RESP" | grep -q '"mfa":true'; then
  TICKET=$(echo "$LOGIN_RESP" | sed 's/.*"ticket":"\([^"]*\)".*/\1/')
  echo "{\"error\":\"mfa_required\",\"ticket\":\"$TICKET\",\"message\":\"Discord requires 2FA code. Please provide your authenticator code.\"}"
  exit 3
fi

# Extract user token
USER_TOKEN=$(echo "$LOGIN_RESP" | sed 's/.*"token":"\([^"]*\)".*/\1/')
if [ -z "$USER_TOKEN" ] || echo "$USER_TOKEN" | grep -q "error"; then
  echo "{\"error\":\"login_failed\",\"response\":$(echo "$LOGIN_RESP" | head -c 500)}"
  exit 4
fi

log "Login successful"

# Step 2: Create Application
log "Creating application..."
APP_RESP=$(curl -s $CURL_EXTRA -X POST "$API/applications" \
  -H "Authorization: $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $UA" \
  -d '{"name":"ClawOS Bot"}')

APP_ID=$(echo "$APP_RESP" | sed 's/.*"id":"\([^"]*\)".*/\1/')
if [ -z "$APP_ID" ] || [ "$APP_ID" = "$APP_RESP" ]; then
  echo "{\"error\":\"app_creation_failed\",\"response\":$(echo "$APP_RESP" | head -c 500)}"
  exit 5
fi

log "Application created: $APP_ID"

# Step 3: Create Bot
log "Creating bot..."
BOT_RESP=$(curl -s $CURL_EXTRA -X POST "$API/applications/$APP_ID/bot" \
  -H "Authorization: $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $UA")

BOT_TOKEN=$(echo "$BOT_RESP" | sed 's/.*"token":"\([^"]*\)".*/\1/')
if [ -z "$BOT_TOKEN" ] || [ "$BOT_TOKEN" = "$BOT_RESP" ]; then
  echo "{\"error\":\"bot_creation_failed\",\"response\":$(echo "$BOT_RESP" | head -c 500)}"
  exit 6
fi

log "Bot created, token obtained"

# Step 4: Enable Privileged Intents (Presence + Server Members + Message Content)
log "Enabling intents..."
# Use the applications endpoint with the user token to set bot flags
INTENT_RESP=$(curl -s $CURL_EXTRA -X PATCH "$API/applications/$APP_ID/bot" \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $UA" \
  -d '{}')

SETTINGS_RESP=$(curl -s $CURL_EXTRA -X PATCH "$API/applications/$APP_ID" \
  -H "Authorization: $USER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: $UA" \
  -d '{"bot_public":true,"bot_require_code_grant":false,"flags":565248}')

log "Setup complete"

# Step 5: Verify bot token
log "Verifying bot..."
VERIFY_RESP=$(curl -s $CURL_EXTRA -H "Authorization: Bot $BOT_TOKEN" "$API/users/@me" \
  -H "User-Agent: $UA")

BOT_USERNAME=$(echo "$VERIFY_RESP" | sed 's/.*"username":"\([^"]*\)".*/\1/')

INVITE_URL="https://discord.com/api/oauth2/authorize?client_id=$APP_ID&permissions=274877975552&scope=bot"

# Output result
echo "{\"success\":true,\"bot_token\":\"$BOT_TOKEN\",\"app_id\":\"$APP_ID\",\"bot_username\":\"$BOT_USERNAME\",\"invite_url\":\"$INVITE_URL\"}"
