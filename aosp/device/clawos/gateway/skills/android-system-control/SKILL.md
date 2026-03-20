---
name: android-system-control
description: Control Android system apps (Camera, SMS, Phone, Contacts, Settings) and perform UI automation on any app via shell commands. Use when the user asks to make calls, send messages, take photos, manage contacts, change settings, or interact with any Android app.
metadata:
  {
    "openclaw":
      {
        "emoji": "📱",
        "tags": ["android", "system", "automation"],
      },
  }
---

# Android System Control

Control Android system applications and automate any app using shell commands via the `exec` tool. The gateway runs as **root**, bypassing most permission restrictions.

## General Principles

1. Use the `exec` tool to run all commands
2. Always verify results after actions (re-read data or use `screencap`)
3. For apps without a direct API, use the **UI Automation** workflow (Section 7)
4. This device is an Android 12 ARM64 emulator — some hardware features (camera sensor, telephony) may be limited

---

## 1. Camera

### Launch Camera and Take Photo

```bash
# Open camera app
am start -a android.media.action.IMAGE_CAPTURE

# Wait for camera to load, then trigger shutter
sleep 2 && input keyevent KEYCODE_CAMERA
```

### Screenshot (Preferred Alternative)

```bash
# Capture current screen to file
screencap -p /sdcard/screenshot.png

# Capture with specific format
screencap /sdcard/screenshot.png
```

### Screen Recording

```bash
# Record screen (max 180 seconds, stop with Ctrl+C or timeout)
screenrecord /sdcard/recording.mp4 --time-limit 10
```

### Open Camera App Directly

```bash
# Launch the AOSP Camera2 app
am start -n com.android.camera2/com.android.camera.CameraLauncher
```

### View Photos in Gallery

```bash
# Open Gallery to browse photos
am start -n com.android.gallery3d/com.android.gallery3d.app.GalleryActivity

# Open a specific image
am start -a android.intent.action.VIEW -d "file:///sdcard/screenshot.png" -t "image/*"
```

### Notes

- The emulator has no physical camera; captured images may be blank or synthetic
- `screencap` always works and captures whatever is currently on screen
- Photos taken by the camera app are saved to `/sdcard/DCIM/Camera/`
- The Gallery2 app can browse all images on the device

---

## 2. SMS / Messaging

### Send SMS (No UI)

```bash
# Send SMS via service call (no UI popup)
# Parameters: subId, callingPkg, destAddr, scAddr, text, sentIntent, deliveryIntent
service call isms 7 i32 0 s16 "com.android.mms.service" s16 "+1234567890" s16 "null" s16 "Hello from ClawOS" s16 "null" s16 "null"
```

### Send SMS (Via UI)

```bash
# Open messaging app with pre-filled content (user must tap Send)
am start -a android.intent.action.SENDTO -d "sms:+1234567890" --es sms_body "Hello from ClawOS"
```

### Read SMS Inbox

```bash
# List inbox messages
content query --uri content://sms/inbox --projection _id,address,body,date,read

# List sent messages
content query --uri content://sms/sent --projection _id,address,body,date

# Search for messages from a specific number
content query --uri content://sms/inbox --where "address='+1234567890'" --projection address,body,date
```

### Delete SMS

```bash
content delete --uri content://sms --where "_id=42"
```

### Notes

- `service call isms` sends without UI but depends on MMS service being available in the ROM
- ClawOS is a stripped ROM — if SMS fails, check if `com.android.mms.service` exists
- In the emulator, SMS sending/receiving depends on emulator telephony simulation

---

## 3. Phone / Dialer

### Make a Call

```bash
# Directly initiate a call (may require confirmation on some ROMs)
am start -a android.intent.action.CALL -d "tel:+1234567890"

# Open dialer with number pre-filled (user must tap Call)
am start -a android.intent.action.DIAL -d "tel:+1234567890"
```

### Answer Incoming Call

```bash
input keyevent KEYCODE_CALL
```

### End / Reject Call

```bash
input keyevent KEYCODE_ENDCALL
```

### View Call Log

```bash
# Recent calls
content query --uri content://call_log/calls --projection number,cached_name,duration,type,date --sort "date DESC"
```

Call type values: 1=incoming, 2=outgoing, 3=missed, 4=voicemail, 5=rejected.

### Notes

- Emulator telephony is simulated; calls may not actually connect to real numbers
- In the emulator, you can simulate incoming calls via the emulator console

---

## 4. Contacts

### Query Contacts

```bash
# List all contacts (name + ID)
content query --uri content://com.android.contacts/contacts --projection _id,display_name

# Get detailed contact info (phone numbers, emails)
content query --uri content://com.android.contacts/data --projection display_name,data1,mimetype --where "mimetype='vnd.android.cursor.item/phone_v2'"

# Search by name
content query --uri content://com.android.contacts/contacts --where "display_name LIKE '%John%'" --projection _id,display_name
```

### Add a Contact

Adding contacts via `content insert` is complex (requires raw_contacts + data rows). Prefer using the UI:

```bash
# Open add-contact screen with pre-filled info
am start -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact \
  --es name "John Doe" \
  --es phone "+1234567890" \
  --es email "john@example.com"
```

### Open Contacts App

```bash
# Launch the Contacts app
am start -n com.android.contacts/com.android.contacts.activities.PeopleActivity
```

### Notes

- Contact data uses a complex multi-table structure (raw_contacts, data, contacts)
- For simple queries, the content provider commands above work well
- For complex operations (add/edit), prefer the UI approach with `am start`
- The Contacts app is pre-installed and can be controlled via UI automation

---

## 5. System Settings

### Read Settings

```bash
# System settings (brightness, font size, etc.)
content query --uri content://settings/system --projection name,value

# Secure settings (location, accessibility, etc.)
content query --uri content://settings/secure --projection name,value

# Global settings (airplane mode, data roaming, etc.)
content query --uri content://settings/global --projection name,value

# Get a specific setting
content query --uri content://settings/system --where "name='screen_brightness'" --projection name,value
```

### Change Settings

```bash
# Set screen brightness (0-255)
content insert --uri content://settings/system --bind name:s:screen_brightness --bind value:s:200

# Enable/disable airplane mode (0=off, 1=on)
content insert --uri content://settings/global --bind name:s:airplane_mode_on --bind value:s:1
# Then broadcast the change
am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true

# Set screen timeout (milliseconds)
content insert --uri content://settings/system --bind name:s:screen_off_timeout --bind value:s:300000
```

### Common Settings Reference

| Setting | URI | Name | Values |
|---------|-----|------|--------|
| Brightness | system | `screen_brightness` | 0-255 |
| Screen timeout | system | `screen_off_timeout` | ms |
| Airplane mode | global | `airplane_mode_on` | 0/1 |
| WiFi | - | - | Use `svc wifi enable/disable` |
| Bluetooth | - | - | Use `svc bluetooth enable/disable` |
| Volume | - | - | Use `media volume --set N --stream S` |

### Quick Commands

```bash
# WiFi on/off
svc wifi enable
svc wifi disable

# Mobile data on/off
svc data enable
svc data disable

# Check WiFi status
dumpsys wifi | grep "Wi-Fi is"

# Set media volume (stream 3 = music, range 0-15)
media volume --set 10 --stream 3
```

---

## 6. Calendar

### Open Calendar App

```bash
am start -n com.android.calendar/com.android.calendar.AllInOneActivity
```

### Query Calendar Events

```bash
# List upcoming events
content query --uri content://com.android.calendar/events --projection _id,title,dtstart,dtend,eventLocation --sort "dtstart ASC"
```

### Add Calendar Event (Via UI)

```bash
# Open "new event" screen with pre-filled info
am start -a android.intent.action.INSERT -t vnd.android.cursor.item/event \
  --es title "Meeting" \
  --es eventLocation "Office" \
  --es description "Team sync" \
  --el beginTime $(date -d '+1 hour' +%s)000 \
  --el endTime $(date -d '+2 hours' +%s)000
```

### Notes

- CalendarProvider is always available for content queries
- The Calendar app provides a visual interface for viewing/editing events
- Times are in milliseconds since epoch

---

## 7. Clock / Alarm

### Open Clock App

```bash
am start -n com.android.deskclock/com.android.deskclock.DeskClock
```

### Set Alarm (Via Intent)

```bash
# Set an alarm (opens DeskClock with alarm details)
am start -a android.intent.action.SET_ALARM \
  --ei android.intent.extra.alarm.HOUR 8 \
  --ei android.intent.extra.alarm.MINUTES 30 \
  --es android.intent.extra.alarm.MESSAGE "Wake up"
```

### Set Timer

```bash
# Start a countdown timer (seconds)
am start -a android.intent.action.SET_TIMER \
  --ei android.intent.extra.alarm.LENGTH 300 \
  --es android.intent.extra.alarm.MESSAGE "Timer done"
```

### Notes

- DeskClock supports alarms, timers, stopwatch, and world clock
- Alarm intents may require user confirmation depending on the ROM
- For detailed control, use UI automation (uiautomator dump + input tap)

---

## 8. App Management

### Launch Apps

```bash
# Launch by package name (find main activity automatically)
monkey -p com.example.app -c android.intent.category.LAUNCHER 1

# Launch specific activity
am start -n com.example.app/.MainActivity
```

### List Installed Apps

```bash
# All packages
pm list packages

# Third-party only
pm list packages -3

# System only
pm list packages -s

# Find a package
pm list packages | grep keyword
```

### Install / Uninstall

```bash
# Install APK
pm install /sdcard/app.apk

# Uninstall
pm uninstall com.example.app
```

### Force Stop / Clear Data

```bash
am force-stop com.example.app
pm clear com.example.app
```

---

## 9. UI Automation (Generic — Works with Any App)

This is the most powerful and general approach. It works with ANY visible app by reading the UI structure and simulating touch events.

### Step 1: Capture UI Structure

```bash
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

The XML contains all visible elements with:
- `text` — displayed text
- `resource-id` — element ID
- `class` — widget class (Button, EditText, etc.)
- `bounds` — screen coordinates as `[left,top][right,bottom]`
- `clickable`, `enabled`, `focused` — interaction state

### Step 2: Parse and Find Target Element

From the XML, find the target element. For example:
```xml
<node text="Send" class="android.widget.Button" bounds="[800,1200][1000,1300]" clickable="true" />
```

Calculate center coordinates: `X = (800+1000)/2 = 900`, `Y = (1200+1300)/2 = 1250`

### Step 3: Interact

```bash
# Tap at coordinates
input tap 900 1250

# Long press (swipe from same point to same point with duration)
input swipe 900 1250 900 1250 1500

# Swipe (scroll down)
input swipe 500 1500 500 500 300

# Type text (into currently focused field)
input text "Hello World"

# Key events
input keyevent KEYCODE_BACK        # Back button
input keyevent KEYCODE_HOME        # Home button
input keyevent KEYCODE_ENTER       # Enter/confirm
input keyevent KEYCODE_TAB         # Tab to next field
input keyevent KEYCODE_DEL         # Backspace
input keyevent KEYCODE_VOLUME_UP   # Volume up
input keyevent KEYCODE_VOLUME_DOWN # Volume down
```

### Step 4: Verify Result

```bash
# Screenshot to verify
screencap -p /sdcard/verify.png

# Or dump UI again to check state
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml
```

### Complete Workflow Template

```bash
# 1. Open target app
monkey -p com.example.app -c android.intent.category.LAUNCHER 1
sleep 2

# 2. Capture UI
uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml

# 3. Find element coordinates from XML, then tap
input tap X Y
sleep 1

# 4. Type text if needed
input text "some text"

# 5. Verify
screencap -p /sdcard/result.png
```

### Tips

- Always `sleep` 1-2 seconds after launching an app or performing an action before dumping UI
- `input text` does not support spaces well on all ROMs; use `input keyevent KEYCODE_SPACE` for spaces
- If an element is off-screen, swipe first to bring it into view
- `uiautomator dump` only captures the current visible UI; dialogs/popups overlay the main content

---

## 10. Content Provider Reference

The `content` command is a powerful tool for reading and writing data from Android content providers.

### Syntax

```bash
# Query
content query --uri <URI> [--projection col1,col2] [--where "clause"] [--sort "col DESC"]

# Insert
content insert --uri <URI> --bind col1:s:stringValue --bind col2:i:42

# Update
content update --uri <URI> --bind col:s:value [--where "clause"]

# Delete
content delete --uri <URI> [--where "clause"]
```

Type codes for `--bind`: `s`=string, `i`=integer, `l`=long, `f`=float, `d`=double, `b`=boolean.

### Common URIs

| Data | URI |
|------|-----|
| SMS Inbox | `content://sms/inbox` |
| SMS Sent | `content://sms/sent` |
| All SMS | `content://sms` |
| Call Log | `content://call_log/calls` |
| Contacts | `content://com.android.contacts/contacts` |
| Contact Data | `content://com.android.contacts/data` |
| Calendar Events | `content://com.android.calendar/events` |
| System Settings | `content://settings/system` |
| Secure Settings | `content://settings/secure` |
| Global Settings | `content://settings/global` |
| Media Images | `content://media/external/images/media` |
| Media Audio | `content://media/external/audio/media` |
