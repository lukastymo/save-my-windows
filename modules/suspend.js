import Gio from 'gi://Gio';

export class SuspendMonitor {
  constructor(onResume) {
    this.onResume = onResume;
    this.proxy = null;
  }

  start() {
    if (this.proxy) return;

    try {
      this.proxy = new Gio.DBusProxy({
        g_connection: Gio.DBus.system,
        g_name: 'org.freedesktop.login1',
        g_object_path: '/org/freedesktop/login1',
        g_interface_name: 'org.freedesktop.login1.Manager',
        g_flags: Gio.DBusProxyFlags.NONE
      });

      this.proxy.connect('g-signal', (proxy, sender, signal, parameters) => {
        if (signal === 'PrepareForSleep') {
          const [sleeping] = parameters.deep_unpack();
          if (!sleeping) {
            // System resumed - restore immediately
            this.onResume();
          }
        }
      });

      this.proxy.init(null);
    } catch (e) {
      console.error(`[SaveMyWindows] Failed to start suspend monitor: ${String(e)}`);
    }
  }

  stop() {
    if (this.proxy) {
      try {
        this.proxy.disconnect('g-signal');
      } catch (e) {
        // Ignore
      }
      this.proxy = null;
    }
  }
}
