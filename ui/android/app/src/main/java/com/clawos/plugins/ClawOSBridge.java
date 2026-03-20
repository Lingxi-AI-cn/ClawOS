package com.clawos.plugins;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.provider.Settings;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.TrafficStats;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.SystemClock;
import android.telephony.TelephonyManager;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.List;
import java.util.UUID;



import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.concurrent.TimeUnit;

import org.json.JSONObject;

import okhttp3.FormBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@CapacitorPlugin(name = "ClawOSBridge")
public class ClawOSBridge extends Plugin {
    private static final String TAG = "ClawOSBridge";
    
    // OAuth state (static so MainActivity can deliver the callback)
    private static PluginCall pendingOAuthCall;
    private static String pendingOAuthState;
    private static String pendingCodeVerifier;
    private static String pendingClientId;
    private static String pendingClientSecret;
    private static String pendingTokenUrl;

    private static final String REDIRECT_URI = "clawos://oauth-callback";
    private static final String CODE_ASSIST_URL =
            "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
    private static final String DEFAULT_PROJECT_ID = "";

    @PluginMethod
    public void getPlatform(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("platform", "android");
        ret.put("isElectron", false);
        ret.put("isAndroid", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getSystemInfo(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();

        // Device info
        ret.put("hostname", Build.MODEL);
        ret.put("platform", "Android " + Build.VERSION.RELEASE);
        ret.put("kernel", System.getProperty("os.version"));
        String arch = Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "unknown";
        ret.put("arch", arch);

        // CPU info
        int cpuCores = Runtime.getRuntime().availableProcessors();
        ret.put("cpuCores", cpuCores);
        ret.put("cpuModel", getCpuModel());
        ret.put("cpuUsage", getCpuUsage(cpuCores));

        // Memory
        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memInfo = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(memInfo);
        ret.put("memTotal", memInfo.totalMem);
        ret.put("memUsed", memInfo.totalMem - memInfo.availMem);

        // Uptime
        ret.put("uptime", SystemClock.elapsedRealtime() / 1000);

        // Network
        ret.put("ip", getLocalIpAddress());
        ret.put("netRxBytes", TrafficStats.getTotalRxBytes());
        ret.put("netTxBytes", TrafficStats.getTotalTxBytes());

        call.resolve(ret);
    }

    @PluginMethod
    public void getStatusBarInfo(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Context context = getContext();

            // Battery
            try {
                BatteryManager bm = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    int level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    int plugged = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS);
                    ret.put("batteryLevel", level >= 0 ? level : 0);
                    ret.put("batteryCharging",
                            plugged == BatteryManager.BATTERY_STATUS_CHARGING
                            || plugged == BatteryManager.BATTERY_STATUS_FULL);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to read battery info", e);
            }
            if (!ret.has("batteryLevel")) {
                ret.put("batteryLevel", -1);
                ret.put("batteryCharging", false);
            }

            // WiFi + Cellular
            boolean wifiConnected = false;
            int wifiStrength = 0;
            boolean hasCellular = false;
            try {
                ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
                if (cm != null) {
                    Network activeNetwork = cm.getActiveNetwork();
                    if (activeNetwork != null) {
                        NetworkCapabilities caps = cm.getNetworkCapabilities(activeNetwork);
                        if (caps != null) {
                            wifiConnected = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                            hasCellular = caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);
                            if (wifiConnected) {
                                try {
                                    WifiManager wm = (WifiManager) context.getApplicationContext()
                                            .getSystemService(Context.WIFI_SERVICE);
                                    if (wm != null) {
                                        WifiInfo wi = wm.getConnectionInfo();
                                        if (wi != null) {
                                            wifiStrength = WifiManager.calculateSignalLevel(wi.getRssi(), 100);
                                        }
                                    }
                                } catch (Exception e) {
                                    Log.w(TAG, "Failed to read WiFi strength", e);
                                }
                            }
                        }
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to read network info", e);
            }
            ret.put("wifiConnected", wifiConnected);
            ret.put("wifiStrength", wifiStrength);

            // Carrier name
            String carrier = "ClawOS";
            int signalBars = 0;
            try {
                TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
                if (tm != null) {
                    String networkOp = tm.getNetworkOperatorName();
                    if (networkOp != null && !networkOp.isEmpty()) {
                        carrier = networkOp;
                    }
                    if (tm.getSimState() == TelephonyManager.SIM_STATE_READY && hasCellular) {
                        signalBars = 3;
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed to read carrier info", e);
            }
            ret.put("carrier", carrier);
            ret.put("signalBars", signalBars);

        } catch (Exception e) {
            Log.e(TAG, "getStatusBarInfo failed", e);
            ret.put("batteryLevel", -1);
            ret.put("batteryCharging", false);
            ret.put("wifiConnected", false);
            ret.put("wifiStrength", 0);
            ret.put("carrier", "ClawOS");
            ret.put("signalBars", 0);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void listDirectory(PluginCall call) {
        String dirPath = call.getString("path");
        if (dirPath == null || dirPath.isEmpty()) {
            File extDir = getContext().getExternalFilesDir(null);
            dirPath = extDir != null ? extDir.getAbsolutePath()
                    : Environment.getExternalStorageDirectory().getAbsolutePath();
        }

        File dir = new File(dirPath);
        if (!dir.exists() || !dir.isDirectory()) {
            call.reject("Directory not found: " + dirPath);
            return;
        }

        JSArray entries = new JSArray();
        File[] files = dir.listFiles();
        if (files == null) files = new File[0];

        // Sort: directories first, then alphabetical
        Arrays.sort(files, Comparator.<File, Boolean>comparing(f -> !f.isDirectory())
                .thenComparing(File::getName));

        for (File file : files) {
            if (file.getName().startsWith(".")) continue;

            JSObject entry = new JSObject();
            entry.put("name", file.getName());
            entry.put("type", file.isDirectory() ? "directory" : file.isFile() ? "file" : "other");
            entry.put("size", file.isFile() ? file.length() : 0);
            entry.put("mtime", (double) file.lastModified());

            String perms = (file.canRead() ? "r" : "-")
                    + (file.canWrite() ? "w" : "-")
                    + (file.canExecute() ? "x" : "-")
                    + "------";
            entry.put("permissions", perms);

            entries.put(entry);
        }

        JSObject ret = new JSObject();
        ret.put("path", dir.getAbsolutePath());
        ret.put("entries", entries);
        call.resolve(ret);
    }

    @PluginMethod
    public void readGatewayConfig(PluginCall call) {
        JSObject ret = new JSObject();

        // Search order: app files dir → runtime data dir → ROM default
        File[] candidates = new File[] {
            new File(getContext().getFilesDir(), "openclaw.json"),
            new File("/data/local/tmp/clawos/openclaw.json"),
            new File("/product/etc/clawos/openclaw-default.json"),
        };

        boolean found = false;
        for (File configFile : candidates) {
            if (configFile.exists() && configFile.canRead()) {
                try {
                    StringBuilder sb = new StringBuilder();
                    BufferedReader reader = new BufferedReader(new FileReader(configFile));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
                    }
                    reader.close();
                    ret.put("config", sb.toString());
                    ret.put("source", configFile.getAbsolutePath());
                    found = true;
                    break;
                } catch (Exception e) {
                    // Try next candidate
                }
            }
        }

        if (!found) {
            ret.put("config", JSObject.NULL);
            ret.put("source", "none");
        }

        ret.put("defaultWsUrl", "ws://localhost:18789");
        call.resolve(ret);
    }

    // ── File I/O for Model Config ─────────────────────────────────

    @PluginMethod
    public void readTextFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        File file = new File(path);
        if (!file.exists() || !file.canRead()) {
            call.reject("File not found or not readable: " + path);
            return;
        }

        try {
            StringBuilder sb = new StringBuilder();
            BufferedReader reader = new BufferedReader(new FileReader(file));
            String line;
            while ((line = reader.readLine()) != null) {
                if (sb.length() > 0) sb.append("\n");
                sb.append(line);
            }
            reader.close();

            JSObject ret = new JSObject();
            ret.put("content", sb.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeTextFile(PluginCall call) {
        String path = call.getString("path");
        String content = call.getString("content");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }
        if (content == null) {
            call.reject("content is required");
            return;
        }

        try {
            File file = new File(path);
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }

            FileWriter writer = new FileWriter(file);
            writer.write(content);
            writer.close();

            file.setReadable(true, false);
            file.setWritable(true, false);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to write file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void patchJsonFile(PluginCall call) {
        String path = call.getString("path");
        String jsonPath = call.getString("jsonPath");
        String valueStr = call.getString("value");

        if (path == null || jsonPath == null || valueStr == null) {
            call.reject("path, jsonPath, and value are required");
            return;
        }

        try {
            // Read existing JSON (or start with empty object)
            JSONObject root;
            File file = new File(path);
            if (file.exists() && file.canRead()) {
                StringBuilder sb = new StringBuilder();
                BufferedReader reader = new BufferedReader(new FileReader(file));
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                root = new JSONObject(sb.toString());
            } else {
                root = new JSONObject();
            }

            // Navigate the dot-separated path, creating intermediate objects
            String[] keys = jsonPath.split("\\.");
            JSONObject current = root;
            for (int i = 0; i < keys.length - 1; i++) {
                if (!current.has(keys[i]) || current.isNull(keys[i])) {
                    current.put(keys[i], new JSONObject());
                }
                current = current.getJSONObject(keys[i]);
            }

            // Parse the value (could be object, array, string, number, etc.)
            String lastKey = keys[keys.length - 1];
            try {
                // Try parsing as JSON object first
                JSONObject valueObj = new JSONObject(valueStr);
                current.put(lastKey, valueObj);
            } catch (Exception e1) {
                // If not valid JSON object, set as raw string
                current.put(lastKey, valueStr);
            }

            // Write back with 2-space indentation
            File parent = file.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            FileWriter writer = new FileWriter(file);
            writer.write(root.toString(2));
            writer.close();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to patch JSON file: " + e.getMessage());
        }
    }

    /**
     * Add model IDs to the agents.defaults.models allow list.
     * Unlike patchJsonFile, this handles model IDs that contain dots
     * (e.g., "ollama/qwen2.5:7b") which would break dot-separated path navigation.
     */
    @PluginMethod
    public void addModelsToAllowList(PluginCall call) {
        String path = call.getString("path");
        JSArray modelIds = call.getArray("modelIds");

        if (path == null || modelIds == null) {
            call.reject("path and modelIds are required");
            return;
        }

        try {
            JSONObject root;
            File file = new File(path);
            if (file.exists() && file.canRead()) {
                StringBuilder sb = new StringBuilder();
                BufferedReader reader = new BufferedReader(new FileReader(file));
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                root = new JSONObject(sb.toString());
            } else {
                root = new JSONObject();
            }

            // Navigate to agents.defaults.models, creating if absent
            if (!root.has("agents")) root.put("agents", new JSONObject());
            JSONObject agents = root.getJSONObject("agents");
            if (!agents.has("defaults")) agents.put("defaults", new JSONObject());
            JSONObject defaults = agents.getJSONObject("defaults");
            if (!defaults.has("models")) defaults.put("models", new JSONObject());
            JSONObject models = defaults.getJSONObject("models");

            for (int i = 0; i < modelIds.length(); i++) {
                String modelId = modelIds.getString(i);
                if (!models.has(modelId)) {
                    models.put(modelId, new JSONObject());
                }
            }

            FileWriter writer = new FileWriter(file);
            writer.write(root.toString(2));
            writer.close();

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("added", modelIds.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to add models to allow list: " + e.getMessage());
        }
    }

    /**
     * Restart the ClawOS Gateway service so it re-reads config files.
     * On userdebug builds, uses su to execute ctl.restart since regular apps
     * lack permission to set ctl.* properties directly.
     */
    @PluginMethod
    public void restartGateway(PluginCall call) {
        new Thread(() -> {
            try {
                // Write a trigger file to app cache. The gateway's background watcher
                // (in start-gateway.sh) detects this via `run-as` and kills the node
                // process. Init then auto-restarts the gateway service.
                File trigger = new File(getContext().getCacheDir(), "restart-gateway");
                trigger.createNewFile();

                // Wait up to 15s for the gateway to actually restart (PID should change)
                String oldPid = getPidOf("node");
                boolean restarted = false;
                for (int i = 0; i < 15; i++) {
                    Thread.sleep(1000);
                    String newPid = getPidOf("node");
                    if (newPid != null && !newPid.isEmpty() && !newPid.equals(oldPid)) {
                        restarted = true;
                        break;
                    }
                }

                // Clean up trigger if watcher didn't get to it
                trigger.delete();

                JSObject ret = new JSObject();
                ret.put("ok", restarted);
                ret.put("method", "trigger-file");
                if (!restarted) {
                    ret.put("error", "Gateway restart timed out. Please reboot the device.");
                }
                final JSObject result = ret;
                getBridge().getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception e) {
                final String msg = e.getMessage();
                getBridge().getActivity().runOnUiThread(() ->
                    call.reject("Failed to restart gateway: " + msg));
            }
        }).start();
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String path = call.getString("path");
        String content = call.getString("content");

        new Thread(() -> {
            try {
                File file = new File(path);
                File parentDir = file.getParentFile();

                Log.d("ClawOSBridge", "writeFile: path=" + path);
                Log.d("ClawOSBridge", "writeFile: parentDir=" + (parentDir != null ? parentDir.getPath() : "null"));

                if (parentDir != null && !parentDir.exists()) {
                    Log.d("ClawOSBridge", "Creating directories...");
                    boolean created = parentDir.mkdirs();
                    Log.d("ClawOSBridge", "mkdirs result: " + created);

                    if (created) {
                        // 递归设置所有父目录的权限
                        File dir = parentDir;
                        while (dir != null && !dir.getPath().equals("/data/local/tmp/clawos/workspace/skills")) {
                            boolean readable = dir.setReadable(true, false);
                            boolean executable = dir.setExecutable(true, false);
                            Log.d("ClawOSBridge", "Set permissions for " + dir.getPath() + ": readable=" + readable + ", executable=" + executable);
                            dir = dir.getParentFile();
                        }
                    }
                }

                FileWriter writer = new FileWriter(file);
                writer.write(content);
                writer.close();

                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                Log.e("ClawOSBridge", "writeFile error: " + e.getMessage(), e);
                call.reject("Failed to write file: " + e.getMessage());
            }
        }).start();
    }

    private File getSkillsDirectory() {
        File skillsDir = new File(getContext().getFilesDir(), "skills");
        if (!skillsDir.exists()) {
            skillsDir.mkdirs();
        }
        // Set permissions to 755 so Gateway (shell user) can read
        skillsDir.setReadable(true, false);
        skillsDir.setExecutable(true, false);

        // Create symlink from Gateway workspace to app private directory
        createSkillsSymlink(skillsDir);

        return skillsDir;
    }

    private void createSkillsSymlink(File skillsDir) {
        try {
            File workspaceSkills = new File("/data/local/tmp/clawos/workspace/skills");
            if (!workspaceSkills.exists() && !Files.isSymbolicLink(workspaceSkills.toPath())) {
                Files.createSymbolicLink(workspaceSkills.toPath(), skillsDir.toPath());
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to create skills symlink: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getSkillsDirectory(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("path", getSkillsDirectory().getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void listInstalledSkills(PluginCall call) {
        new Thread(() -> {
            try {
                File skillsDir = getSkillsDirectory();
                JSArray skills = new JSArray();

                if (skillsDir.exists() && skillsDir.isDirectory()) {
                    File[] dirs = skillsDir.listFiles(File::isDirectory);
                    if (dirs != null) {
                        for (File dir : dirs) {
                            skills.put(dir.getName());
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("skills", skills);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to list skills: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void deleteSkill(PluginCall call) {
        String slug = call.getString("slug");

        new Thread(() -> {
            try {
                File skillDir = new File(getSkillsDirectory(), slug);
                if (skillDir.exists()) {
                    deleteRecursive(skillDir);
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Failed to delete skill: " + e.getMessage());
            }
        }).start();
    }

    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] files = file.listFiles();
            if (files != null) {
                for (File f : files) {
                    deleteRecursive(f);
                }
            }
        }
        file.delete();
    }

    private String getPidOf(String processName) {
        try {
            ProcessBuilder pb = new ProcessBuilder("pidof", processName);
            pb.redirectErrorStream(true);
            Process p = pb.start();
            java.io.BufferedReader r = new java.io.BufferedReader(
                new java.io.InputStreamReader(p.getInputStream()));
            String pid = r.readLine();
            r.close();
            p.waitFor();
            return pid != null ? pid.trim() : null;
        } catch (Exception e) {
            return null;
        }
    }

    // ── App Drawer ─────────────────────────────────────────────────

    @PluginMethod
    public void getInstalledApps(PluginCall call) {
        new Thread(() -> {
            try {
                Context context = getContext();
                PackageManager pm = context.getPackageManager();
                Intent launcherIntent = new Intent(Intent.ACTION_MAIN);
                launcherIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> activities = pm.queryIntentActivities(launcherIntent, 0);

                JSArray apps = new JSArray();
                String ownPackage = context.getPackageName();

                for (ResolveInfo ri : activities) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(ownPackage)) continue;

                    JSObject app = new JSObject();
                    app.put("packageName", pkg);
                    app.put("label", ri.loadLabel(pm).toString());
                    app.put("isSystem",
                            (ri.activityInfo.applicationInfo.flags &
                                    android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0);

                    try {
                        Drawable icon = ri.loadIcon(pm);
                        int size = 96;
                        Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bmp);
                        icon.setBounds(0, 0, size, size);
                        icon.draw(canvas);
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        bmp.compress(Bitmap.CompressFormat.PNG, 90, baos);
                        bmp.recycle();
                        String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
                        app.put("icon", "data:image/png;base64," + b64);
                    } catch (Exception e) {
                        app.put("icon", "");
                    }

                    apps.put(app);
                }

                JSObject ret = new JSObject();
                ret.put("apps", apps);
                final JSObject result = ret;
                getBridge().getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception e) {
                final String msg = e.getMessage();
                getBridge().getActivity().runOnUiThread(() ->
                    call.reject("Failed to get installed apps: " + msg));
            }
        }).start();
    }

    @PluginMethod
    public void launchApp(PluginCall call) {
        String packageName = call.getString("packageName");
        if (packageName == null || packageName.isEmpty()) {
            call.reject("packageName is required");
            return;
        }

        try {
            Context context = getContext();
            PackageManager pm = context.getPackageManager();
            Intent intent = pm.getLaunchIntentForPackage(packageName);

            if (intent == null) {
                // Fallback for settings and other system apps
                if ("com.android.settings".equals(packageName)) {
                    intent = new Intent(Settings.ACTION_SETTINGS);
                } else {
                    call.reject("Cannot launch app: " + packageName);
                    return;
                }
            }

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            context.startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to launch app: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String action = call.getString("action", Settings.ACTION_SETTINGS);
        try {
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to open settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Intent chooser = Intent.createChooser(intent, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to open URL: " + e.getMessage());
        }
    }

    /**
     * Install a plugin from Gateway bundle or ROM to the writable extensions dir.
     * Source priority: gateway bundle > ROM path.
     * Destination: /data/local/tmp/clawos/.openclaw/extensions/{pluginId}/
     */
    @PluginMethod
    public void installPlugin(PluginCall call) {
        String pluginId = call.getString("pluginId");
        if (pluginId == null || pluginId.isEmpty()) {
            call.reject("pluginId is required");
            return;
        }

        new Thread(() -> {
            try {
                String bundleSrc = "/data/local/tmp/clawos/gateway/extensions/" + pluginId;
                String romSrc = "/product/etc/clawos/extensions/" + pluginId;
                String dstDir = "/data/local/tmp/clawos/.openclaw/extensions/" + pluginId;

                File src = new File(bundleSrc);
                if (!src.exists() || !src.isDirectory()) {
                    src = new File(romSrc);
                }
                if (!src.exists() || !src.isDirectory()) {
                    final String msg = "Plugin '" + pluginId + "' not found in gateway bundle or ROM";
                    getBridge().getActivity().runOnUiThread(() -> call.reject(msg));
                    return;
                }

                final String srcPath = src.getAbsolutePath();
                boolean shellCopyOk = false;
                try {
                    String[] cmd = { "/system/bin/sh", "-c",
                        "mkdir -p " + dstDir + " && cp -r " + srcPath + "/* " + dstDir + "/ && chmod -R 777 " + dstDir };
                    Process proc = Runtime.getRuntime().exec(cmd);
                    shellCopyOk = (proc.waitFor() == 0);
                } catch (Exception ignored) {
                }

                if (!shellCopyOk) {
                    File dstFile = new File(dstDir);
                    dstFile.mkdirs();
                    copyDirectory(src, dstFile);
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("pluginId", pluginId);
                ret.put("path", dstDir);
                ret.put("source", srcPath);
                getBridge().getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                final String msg = e.getMessage();
                getBridge().getActivity().runOnUiThread(() ->
                    call.reject("Failed to install plugin: " + msg));
            }
        }).start();
    }

    private void copyDirectory(File src, File dst) throws java.io.IOException {
        if (!dst.exists()) dst.mkdirs();
        File[] files = src.listFiles();
        if (files == null) return;
        for (File file : files) {
            File dstFile = new File(dst, file.getName());
            if (file.isDirectory()) {
                copyDirectory(file, dstFile);
            } else {
                java.io.InputStream in = new java.io.FileInputStream(file);
                java.io.OutputStream out = new java.io.FileOutputStream(dstFile);
                byte[] buf = new byte[4096];
                int len;
                while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
                in.close();
                out.close();
            }
        }
    }

    // ── OTA Gateway Update ─────────────────────────────────────

    private static final String OTA_SCRIPT = "/data/local/tmp/clawos/ota-update.mjs";
    private static final String NODE_BIN = "/product/bin/node";
    private static final String[] DNS_POLYFILL_PATHS = {
        "/data/local/tmp/clawos/gateway/dns-polyfill.cjs",
        "/product/etc/clawos/gateway/dns-polyfill.cjs",
    };

    private void runOtaCommand(PluginCall call, String mode) {
        new Thread(() -> {
            try {
                java.util.List<String> cmd = new java.util.ArrayList<>();
                cmd.add(NODE_BIN);
                for (String p : DNS_POLYFILL_PATHS) {
                    if (new File(p).exists()) {
                        cmd.add("--require");
                        cmd.add(p);
                        break;
                    }
                }
                cmd.add(OTA_SCRIPT);
                cmd.add(mode);

                File otaCacheDir = new File(getContext().getCacheDir(), "ota-pending");
                if (!otaCacheDir.exists()) otaCacheDir.mkdirs();

                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.environment().put("HOME", "/data/local/tmp/clawos");
                pb.environment().put("TMPDIR", getContext().getCacheDir().getAbsolutePath());
                pb.environment().put("PATH", "/product/bin:/system/bin:/system/xbin:/sbin:/vendor/bin");
                pb.environment().put("OTA_PENDING_DIR", otaCacheDir.getAbsolutePath());
                pb.redirectErrorStream(true);
                Process proc = pb.start();

                StringBuilder sb = new StringBuilder();
                java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(proc.getInputStream()));
                String line;
                while ((line = reader.readLine()) != null) {
                    if (sb.length() > 0) sb.append('\n');
                    sb.append(line);
                }
                reader.close();

                int exitCode = proc.waitFor();
                String output = sb.toString().trim();

                JSObject ret = null;
                try {
                    // Parse the last JSON line (the script may output progress lines)
                    String[] lines = output.split("\n");
                    for (int i = lines.length - 1; i >= 0; i--) {
                        String jsonLine = lines[i].trim();
                        if (jsonLine.startsWith("{") && jsonLine.endsWith("}")) {
                            JSONObject json = new JSONObject(jsonLine);
                            ret = JSObject.fromJSONObject(json);
                            break;
                        }
                    }
                } catch (Exception e) {
                    // fall through
                }
                if (ret == null) {
                    ret = new JSObject();
                    if (exitCode != 0) {
                        ret.put("error", output.length() > 200 ? output.substring(output.length() - 200) : output);
                    } else {
                        ret.put("raw", output);
                    }
                }
                ret.put("exitCode", exitCode);

                final JSObject result = ret;
                getBridge().getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception e) {
                final String msg = e.getMessage();
                getBridge().getActivity().runOnUiThread(() ->
                    call.reject("OTA command failed: " + msg));
            }
        }).start();
    }

    @PluginMethod
    public void checkGatewayUpdate(PluginCall call) {
        runOtaCommand(call, "--check");
    }

    @PluginMethod
    public void applyGatewayUpdate(PluginCall call) {
        runOtaCommand(call, "--apply");
    }

    @PluginMethod
    public void rollbackGateway(PluginCall call) {
        runOtaCommand(call, "--rollback");
    }

    @PluginMethod
    public void getGatewayVersion(PluginCall call) {
        runOtaCommand(call, "--version");
    }

    // ── OAuth ────────────────────────────────────────────────────

    @PluginMethod
    public void startOAuthFlow(PluginCall call) {
        String authUrl = call.getString("authUrl");
        String email = call.getString("email", "");
        String clientId = call.getString("clientId");
        String clientSecret = call.getString("clientSecret", "");
        String tokenUrl = call.getString("tokenUrl", "https://oauth2.googleapis.com/token");
        com.getcapacitor.JSArray scopesArray = call.getArray("scopes");

        if (authUrl == null || authUrl.isEmpty()) {
            call.reject("authUrl is required");
            return;
        }
        if (clientId == null || clientId.isEmpty()) {
            call.reject("clientId is required");
            return;
        }

        try {
            // PKCE: generate code_verifier and code_challenge
            byte[] bytes = new byte[32];
            new SecureRandom().nextBytes(bytes);
            String codeVerifier = Base64.encodeToString(bytes,
                    Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
            String codeChallenge = Base64.encodeToString(hash,
                    Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);

            String state = UUID.randomUUID().toString();

            // Build scope string
            StringBuilder scopeBuilder = new StringBuilder();
            if (scopesArray != null) {
                for (int i = 0; i < scopesArray.length(); i++) {
                    if (i > 0) scopeBuilder.append(" ");
                    scopeBuilder.append(scopesArray.getString(i));
                }
            }

            // Build authorization URL
            Uri uri = Uri.parse(authUrl).buildUpon()
                    .appendQueryParameter("client_id", clientId)
                    .appendQueryParameter("redirect_uri", REDIRECT_URI)
                    .appendQueryParameter("response_type", "code")
                    .appendQueryParameter("scope", scopeBuilder.toString())
                    .appendQueryParameter("state", state)
                    .appendQueryParameter("code_challenge", codeChallenge)
                    .appendQueryParameter("code_challenge_method", "S256")
                    .appendQueryParameter("access_type", "offline")
                    .appendQueryParameter("prompt", "consent")
                    .appendQueryParameter("login_hint", email)
                    .build();

            // Store pending state
            pendingOAuthCall = call;
            pendingOAuthState = state;
            pendingCodeVerifier = codeVerifier;
            pendingClientId = clientId;
            pendingClientSecret = clientSecret;
            pendingTokenUrl = tokenUrl;

            // Open browser — keep call alive until callback arrives
            call.setKeepAlive(true);
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);

        } catch (Exception e) {
            call.reject("Failed to start OAuth: " + e.getMessage());
        }
    }

    /**
     * Called by MainActivity.onNewIntent when clawos://oauth-callback is received.
     * Exchanges the authorization code for tokens and resolves the pending JS call.
     */
    public static void handleOAuthCallback(Uri callbackUri) {
        final PluginCall call = pendingOAuthCall;
        if (call == null) return;

        String error = callbackUri.getQueryParameter("error");
        if (error != null) {
            pendingOAuthCall = null;
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", error);
            call.resolve(result);
            return;
        }

        String code = callbackUri.getQueryParameter("code");
        String returnedState = callbackUri.getQueryParameter("state");

        if (code == null || !pendingOAuthState.equals(returnedState)) {
            pendingOAuthCall = null;
            JSObject result = new JSObject();
            result.put("success", false);
            result.put("error", "Invalid OAuth callback");
            call.resolve(result);
            return;
        }

        final String verifier = pendingCodeVerifier;
        final String clientId = pendingClientId;
        final String clientSecret = pendingClientSecret;
        final String tokenUrl = pendingTokenUrl;
        pendingOAuthCall = null;
        pendingOAuthState = null;
        pendingCodeVerifier = null;
        pendingClientId = null;
        pendingClientSecret = null;
        pendingTokenUrl = null;

        // Exchange code for tokens on a background thread
        new Thread(() -> {
            JSObject result = new JSObject();
            try {
                OkHttpClient httpClient = new OkHttpClient.Builder()
                        .connectTimeout(15, TimeUnit.SECONDS)
                        .readTimeout(15, TimeUnit.SECONDS)
                        .build();

                RequestBody body = new FormBody.Builder()
                        .add("code", code)
                        .add("client_id", clientId)
                        .add("client_secret", clientSecret)
                        .add("redirect_uri", REDIRECT_URI)
                        .add("grant_type", "authorization_code")
                        .add("code_verifier", verifier)
                        .build();

                Request request = new Request.Builder()
                        .url(tokenUrl)
                        .post(body)
                        .build();

                String accessToken, refreshToken;
                long expiresAt;
                try (Response response = httpClient.newCall(request).execute()) {
                    String responseBody = response.body() != null ? response.body().string() : "{}";
                    JSONObject json = new JSONObject(responseBody);

                    if (!response.isSuccessful()) {
                        result.put("success", false);
                        result.put("error", json.optString("error_description", "Token exchange failed"));
                        call.resolve(result);
                        return;
                    }
                    accessToken = json.optString("access_token");
                    refreshToken = json.optString("refresh_token");
                    long expiresIn = json.optLong("expires_in", 3600);
                    expiresAt = System.currentTimeMillis() + expiresIn * 1000L - 5 * 60 * 1000L;
                }

                // Fetch Cloud Code Assist project ID (mirrors desktop extension logic)
                String projectId = DEFAULT_PROJECT_ID;
                try {
                    String caBody = "{\"metadata\":{\"ideType\":\"IDE_UNSPECIFIED\",\"platform\":\"PLATFORM_UNSPECIFIED\",\"pluginType\":\"GEMINI\"}}";
                    Request caReq = new Request.Builder()
                            .url(CODE_ASSIST_URL)
                            .post(okhttp3.RequestBody.create(
                                    caBody, okhttp3.MediaType.parse("application/json")))
                            .header("Authorization", "Bearer " + accessToken)
                            .build();
                    try (Response caResp = httpClient.newCall(caReq).execute()) {
                        if (caResp.isSuccessful() && caResp.body() != null) {
                            JSONObject caJson = new JSONObject(caResp.body().string());
                            String pid = caJson.optString("cloudaicompanionProject", "");
                            if (!pid.isEmpty()) projectId = pid;
                        }
                    }
                } catch (Exception ignored) {}

                result.put("success", true);
                result.put("accessToken", accessToken);
                result.put("refreshToken", refreshToken);
                result.put("expiresAt", expiresAt);
                result.put("projectId", projectId);
            } catch (Exception e) {
                result.put("success", false);
                result.put("error", e.getMessage());
            }
            call.resolve(result);
        }).start();
    }

    // ── Helpers ──────────────────────────────────────────────────

    private String getCpuModel() {
        try {
            BufferedReader reader = new BufferedReader(new FileReader("/proc/cpuinfo"));
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith("Hardware") || line.startsWith("model name")) {
                    reader.close();
                    return line.substring(line.indexOf(':') + 1).trim();
                }
            }
            reader.close();
        } catch (Exception ignored) {}
        return Build.HARDWARE;
    }

    private double getCpuUsage(int cpuCores) {
        try {
            BufferedReader reader = new BufferedReader(new FileReader("/proc/loadavg"));
            String content = reader.readLine();
            reader.close();
            if (content != null) {
                double load1min = Double.parseDouble(content.split(" ")[0]);
                return Math.min(100.0, (load1min / cpuCores) * 100.0);
            }
        } catch (Exception ignored) {}
        return 0.0;
    }

    private String getLocalIpAddress() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                for (InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr.getHostAddress().contains(".")) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "127.0.0.1";
    }
}
