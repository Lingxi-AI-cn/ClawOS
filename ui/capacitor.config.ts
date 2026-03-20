import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.clawos.app',
  appName: 'ClawOS',
  webDir: 'dist',
  android: {
    allowMixedContent: true,  // Allow ws:// from WebView
  },
  server: {
    androidScheme: 'http',    // Use http to allow ws://localhost connections
  },
};

export default config;
