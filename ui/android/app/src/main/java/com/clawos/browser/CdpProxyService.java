package com.clawos.browser;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * CDP (Chrome DevTools Protocol) Proxy Service.
 *
 * Bridges TCP connections on localhost:9222 to a browser's Unix abstract
 * socket. Prefers Cromite's @chrome_devtools_remote (full CDP), falls
 * back to WebView's @webview_devtools_remote_<PID> if Cromite is not
 * available.
 *
 * This allows OpenClaw's Playwright (running in the Gateway's Node.js)
 * to connect using:
 *   chromium.connectOverCDP("http://localhost:9222")
 */
public class CdpProxyService extends Service {

    private static final String TAG = "CdpProxy";
    private static final int CDP_PORT = 9222;
    private static final int MAX_BACKOFF_MS = 30_000;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private volatile ServerSocket serverSocket;
    private volatile ExecutorService executor;
    private volatile String webviewSocketName;

    private static final String CHANNEL_ID = "cdp_proxy";
    private static final int NOTIFICATION_ID = 9222;

    public static void start(Context context) {
        Intent intent = new Intent(context, CdpProxyService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, CdpProxyService.class);
        context.stopService(intent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundNotification();

        if (running.get()) {
            Log.i(TAG, "CDP proxy already running on port " + CDP_PORT);
            return START_STICKY;
        }

        Log.i(TAG, "Starting CDP proxy service...");

        if (executor != null) {
            executor.shutdownNow();
        }
        executor = Executors.newCachedThreadPool();
        executor.execute(this::proxyLoop);

        return START_STICKY;
    }

    private void startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "CDP Proxy", NotificationManager.IMPORTANCE_MIN);
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }

        Notification notification = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            notification = new Notification.Builder(this, CHANNEL_ID)
                    .setContentTitle("ClawOS Browser")
                    .setContentText("CDP proxy active")
                    .setSmallIcon(android.R.drawable.ic_menu_compass)
                    .setOngoing(true)
                    .build();
        }

        if (notification != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        }
    }

    @Override
    public void onDestroy() {
        running.set(false);
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
        if (executor != null) executor.shutdownNow();
        Log.i(TAG, "CDP proxy stopped");
        super.onDestroy();
    }

    private void proxyLoop() {
        running.set(true);
        int attempt = 0;

        while (running.get()) {
            try { Thread.sleep(2000); } catch (InterruptedException e) { return; }

            webviewSocketName = findWebViewSocket();
            if (webviewSocketName == null) {
                attempt++;
                long backoff = Math.min(3000L * attempt, MAX_BACKOFF_MS);
                Log.w(TAG, "No devtools socket found (attempt " + attempt
                        + "), retrying in " + backoff + "ms...");
                try { Thread.sleep(backoff); } catch (InterruptedException e) { return; }
                continue;
            }

            Log.i(TAG, "Found devtools socket: " + webviewSocketName);
            attempt = 0;

            try {
                serverSocket = new ServerSocket(CDP_PORT, 10, java.net.InetAddress.getByName("127.0.0.1"));
                Log.i(TAG, "CDP proxy listening on localhost:" + CDP_PORT);

                while (running.get()) {
                    try {
                        Socket client = serverSocket.accept();
                        executor.execute(() -> handleConnection(client));
                    } catch (IOException e) {
                        if (running.get()) {
                            Log.w(TAG, "Accept error: " + e.getMessage());
                        }
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "TCP server error on port " + CDP_PORT + ": " + e.getMessage());
                try {
                    if (serverSocket != null) serverSocket.close();
                } catch (IOException ignored) {}
                serverSocket = null;
                webviewSocketName = null;
                if (running.get()) {
                    Log.i(TAG, "Will retry binding port " + CDP_PORT + " ...");
                    try { Thread.sleep(5000); } catch (InterruptedException ex) { return; }
                }
            }
        }

        running.set(false);
    }

    private void handleConnection(Socket client) {
        LocalSocket webviewSocket = null;
        try {
            // Re-evaluate on every connection: prefer Cromite if it has
            // come online since the proxy started.
            String socketName = findWebViewSocket();
            if (socketName == null) {
                Log.w(TAG, "No devtools socket available for connection");
                client.close();
                return;
            }
            if (!socketName.equals(webviewSocketName)) {
                Log.i(TAG, "Switching to socket: " + socketName);
            }
            webviewSocketName = socketName;

            webviewSocket = new LocalSocket();
            webviewSocket.connect(new LocalSocketAddress(socketName, LocalSocketAddress.Namespace.ABSTRACT));

            Log.d(TAG, "Proxying connection to " + socketName);

            final InputStream clientIn = client.getInputStream();
            final OutputStream clientOut = client.getOutputStream();
            final InputStream wvIn = webviewSocket.getInputStream();
            final OutputStream wvOut = webviewSocket.getOutputStream();

            final LocalSocket wvRef = webviewSocket;
            final Socket cRef = client;

            Thread t1 = new Thread(() -> {
                try {
                    pipe(clientIn, wvOut);
                } catch (IOException ignored) {} finally {
                    try { cRef.close(); } catch (IOException ignored) {}
                    try { wvRef.close(); } catch (IOException ignored) {}
                }
            }, "cdp-c2w");

            Thread t2 = new Thread(() -> {
                try {
                    pipe(wvIn, clientOut);
                } catch (IOException ignored) {} finally {
                    try { cRef.close(); } catch (IOException ignored) {}
                    try { wvRef.close(); } catch (IOException ignored) {}
                }
            }, "cdp-w2c");

            t1.start();
            t2.start();
            t1.join();
            t2.join();

        } catch (Exception e) {
            Log.w(TAG, "Proxy connection error: " + e.getMessage());
        } finally {
            try { client.close(); } catch (IOException ignored) {}
            try { if (webviewSocket != null) webviewSocket.close(); } catch (IOException ignored) {}
        }
    }

    private void pipe(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            out.flush();
        }
    }

    /**
     * Find a browser devtools abstract Unix socket.
     * Prefers Cromite (chrome_devtools_remote) for full CDP support,
     * falls back to WebView sockets.
     */
    private String findWebViewSocket() {
        // Cromite (full Chromium CDP) — highest priority
        if (isSocketAvailable("chrome_devtools_remote")) {
            Log.d(TAG, "Cromite socket found: chrome_devtools_remote");
            return "chrome_devtools_remote";
        }

        int myPid = android.os.Process.myPid();
        String[] fallbacks = {
                "webview_devtools_remote_" + myPid,
                "chrome_devtools_remote_" + myPid,
                "devtools_remote_" + myPid,
                "webview_devtools_remote",
        };
        for (String name : fallbacks) {
            if (isSocketAvailable(name)) {
                Log.d(TAG, "Fallback socket found: " + name);
                return name;
            }
        }

        // Scan /proc/net/unix for any devtools_remote socket
        Pattern pattern = Pattern.compile("@?((?:webview_|chrome_)?devtools_remote(?:_\\d+)?)");
        try {
            Process proc = Runtime.getRuntime().exec(new String[]{"cat", "/proc/net/unix"});
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    Matcher m = pattern.matcher(line);
                    if (m.find()) {
                        String name = m.group(1);
                        Log.d(TAG, "Found in /proc/net/unix: " + name);
                        if (isSocketAvailable(name)) {
                            return name;
                        }
                    }
                }
            }
            proc.waitFor();
        } catch (Exception e) {
            Log.w(TAG, "Failed to scan /proc/net/unix: " + e.getMessage());
        }

        Log.d(TAG, "No devtools socket found (PID=" + myPid + ")");
        return null;
    }

    private boolean isSocketAvailable(String name) {
        try (LocalSocket ls = new LocalSocket()) {
            ls.connect(new LocalSocketAddress(name, LocalSocketAddress.Namespace.ABSTRACT));
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
