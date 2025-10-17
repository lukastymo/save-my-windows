import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Meta from 'gi://Meta';

const EXTENSION_NAME = "SaveMyWindows"
const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'save-my-windows']);
const LAYOUT_FILE = GLib.build_filenamev([CONFIG_DIR, 'layout.json']);
const SETTINGS_FILE = GLib.build_filenamev([CONFIG_DIR, 'settings.json']);

const AUTO_SAVE_INTERVAL_MINS = 5;

function ensureConfigDir() {
  if (!GLib.file_test(CONFIG_DIR, GLib.FileTest.IS_DIR)) {
    Gio.File.new_for_path(CONFIG_DIR).make_directory_with_parents(null);
  }
}

function loadSettings() {
  try {
    ensureConfigDir();
    const [ok, contents] = GLib.file_get_contents(SETTINGS_FILE);
    if (!ok) return {};
    
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(contents));
  } catch (e) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    ensureConfigDir();
    const data = JSON.stringify(settings, null, 2);
    GLib.file_set_contents(SETTINGS_FILE, data);
  } catch (e) {
    log(`[${EXTENSION_NAME}] Failed to save settings: ${String(e)}`);
  }
}

export default class SaveMyWindowsExtension {
  constructor() {
    this.dbusImpl = null;
    this.autoSaveIntervalMins = AUTO_SAVE_INTERVAL_MINS;
    this.autoSaveTimeoutId = null;
    this.button = null;
    this.autoRestoreAfterSuspend = false;
    this.suspendMonitor = null;

    this.xml = `
      <node>
        <interface name="org.gnome.Shell.Extensions.SaveMyWindows">
          <method name="ListWindows">
            <arg type="s" name="result" direction="out"/>
          </method>
          <method name="SaveLayout">
            <arg type="s" name="result" direction="out"/>
          </method>
          <method name="RestoreLayout">
            <arg type="s" name="result" direction="out"/>
          </method>
        </interface>
      </node>`;
  }

  _collectWindows() {
    const result = [];
    for (const actor of global.get_window_actors()) {
      const w = actor.meta_window;
      if (!w || w.get_window_type() !== Meta.WindowType.NORMAL) continue;

      const ws = w.get_workspace();
      const rect = w.get_frame_rect();

      result.push({
        title: w.get_title(),
        workspace: ws ? ws.index() : -1,
        monitor: w.get_monitor(),
        wm_class: w.get_wm_class() || '',
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      });
    }
    return result;
  }

  ListWindows() {
    return JSON.stringify(this._collectWindows());
  }

  SaveLayout() {
    ensureConfigDir();
    const data = JSON.stringify(this._collectWindows(), null, 2);
    GLib.file_set_contents(LAYOUT_FILE, data);
    return `Layout saved`;
  }

  RestoreLayout() {
    try {
      ensureConfigDir();

      const [ok, contents] = GLib.file_get_contents(LAYOUT_FILE);
      if (!ok) {
        log(`[${EXTENSION_NAME}] Layout file not found: ${LAYOUT_FILE}`);
        return `No saved layout found`;
      }

      // Decode bytes → string (modern GJS; ByteArray is deprecated)
      const decoder = new TextDecoder(); // defaults to 'utf-8'
      const saved = JSON.parse(decoder.decode(contents));
      log(`[${EXTENSION_NAME}] Loaded ${saved.length} saved windows`);

      let restoredCount = 0;
      for (const actor of global.get_window_actors()) {
        const w = actor.meta_window;
        if (!w || w.get_window_type() !== Meta.WindowType.NORMAL) continue;

        const match = saved.find(s =>
          s.wm_class === (w.get_wm_class() || '') &&
          s.title === w.get_title()
        );
        if (!match) continue;

        log(`[${EXTENSION_NAME}] Restoring window: ${w.get_title()}`);
        
        // Add small delay between operations for Wayland
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
          if (match.workspace >= 0) {
            const ws = global.workspace_manager.get_workspace_by_index(match.workspace);
            if (ws) {
              log(`[${EXTENSION_NAME}] Moving to workspace ${match.workspace}`);
              w.change_workspace(ws);
            }
          }
          return GLib.SOURCE_REMOVE;
        });
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
          if (match.monitor >= 0) {
            log(`[${EXTENSION_NAME}] Moving to monitor ${match.monitor}`);
            w.move_to_monitor(match.monitor);
          }
          return GLib.SOURCE_REMOVE;
        });
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          if (match.x !== undefined && match.y !== undefined &&
            match.width !== undefined && match.height !== undefined) {
            log(`[${EXTENSION_NAME}] Resizing to ${match.x},${match.y} ${match.width}x${match.height}`);
            w.move_resize_frame(true, match.x, match.y, match.width, match.height);
          }
          return GLib.SOURCE_REMOVE;
        });
        
        restoredCount++;
      }
      
      log(`[${EXTENSION_NAME}] Restored ${restoredCount} windows`);
      return `Restored ${restoredCount} windows`;
    } catch (e) {
      log(`[${EXTENSION_NAME}] Restore failed: ${String(e)}`);
      return `Restore failed: ${String(e)}`;
    }
  }

  _addPanelMenu() {
    this.button = new PanelMenu.Button(0.0, 'Save My Windows', false);

    const icon = new St.Icon({
      icon_name: 'document-save-symbolic',
      style_class: 'system-status-icon',
    });
    this.button.add_child(icon);

    const saveItem = new PopupMenu.PopupMenuItem('Save Layout');
    saveItem.connect('activate', () => {
      this.SaveLayout();
      Main.notify('Save My Windows', 'Layout saved.');
    });
    this.button.menu.addMenuItem(saveItem);

    const restoreItem = new PopupMenu.PopupMenuItem('Restore Layout');
    restoreItem.connect('activate', () => {
      log(`[${EXTENSION_NAME}] User clicked manual restore layout`);
      const result = this.RestoreLayout();
      log(`[${EXTENSION_NAME}] Manual restore result: ${result}`);
      Main.notify('Save My Windows', 'Layout restored.');
    });
    this.button.menu.addMenuItem(restoreItem);

    // Add separator
    this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Add auto-restore checkbox
    const autoRestoreItem = new PopupMenu.PopupSwitchMenuItem('Restore automatically after suspend', this.autoRestoreAfterSuspend);
    autoRestoreItem.connect('toggled', (item, state) => {
      this.autoRestoreAfterSuspend = state;
      this._saveAutoRestoreSetting();
      if (state) {
        log(`[${EXTENSION_NAME}] User enabled auto-restore after suspend`);
        this._startSuspendMonitor();
        Main.notify('Save My Windows', 'Auto-restore after suspend enabled.');
      } else {
        log(`[${EXTENSION_NAME}] User disabled auto-restore after suspend`);
        this._stopSuspendMonitor();
        Main.notify('Save My Windows', 'Auto-restore after suspend disabled.');
      }
    });
    this.button.menu.addMenuItem(autoRestoreItem);

    Main.panel.addToStatusArea('save-my-windows', this.button);
  }

  _startAutoSave() {
    if (this.autoSaveTimeoutId) GLib.source_remove(this.autoSaveTimeoutId);

    this.autoSaveTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      this.autoSaveIntervalMins * 60,
      () => {
        this.SaveLayout();
        log(`[${EXTENSION_NAME}] Auto-saved layout to ${LAYOUT_FILE}`);
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  _stopAutoSave() {
    if (this.autoSaveTimeoutId) {
      GLib.source_remove(this.autoSaveTimeoutId);
      this.autoSaveTimeoutId = null;
    }
  }

  _startSuspendMonitor() {
    if (!this.autoRestoreAfterSuspend) return;

    try {
      // Monitor systemd-logind for suspend/resume events
      this.suspendMonitor = new Gio.DBusProxy({
        g_connection: Gio.DBus.system,
        g_name: 'org.freedesktop.login1',
        g_object_path: '/org/freedesktop/login1',
        g_interface_name: 'org.freedesktop.login1.Manager',
        g_flags: Gio.DBusProxyFlags.NONE
      });
      
      this.suspendMonitor.connect('g-signal', (proxy, sender, signal, parameters) => {
        if (signal === 'PrepareForSleep') {
          const [sleeping] = parameters.deep_unpack();
          if (!sleeping) {
            // System is resuming from suspend
            log(`[${EXTENSION_NAME}] System resumed from suspend, restoring layout...`);
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
              log(`[${EXTENSION_NAME}] About to restore layout after suspend...`);
              const result = this.RestoreLayout();
              log(`[${EXTENSION_NAME}] Restore result: ${result}`);
              Main.notify('Save My Windows', `Auto-restore: ${result}`);
              return GLib.SOURCE_REMOVE;
            });
          }
        }
      });
      
      this.suspendMonitor.init(null);
    } catch (e) {
      log(`[${EXTENSION_NAME}] Failed to start suspend monitor: ${String(e)}`);
    }
  }

  _stopSuspendMonitor() {
    if (this.suspendMonitor) {
      try {
        this.suspendMonitor.disconnect('g-signal');
      } catch (e) {
        log(`[${EXTENSION_NAME}] Error disconnecting suspend monitor: ${String(e)}`);
      }
      this.suspendMonitor = null;
    }
  }

  _saveAutoRestoreSetting() {
    const settings = loadSettings();
    settings.autoRestoreAfterSuspend = this.autoRestoreAfterSuspend;
    saveSettings(settings);
  }

  _loadAutoRestoreSetting() {
    const settings = loadSettings();
    this.autoRestoreAfterSuspend = settings.autoRestoreAfterSuspend || false;
  }

  enable() {
    ensureConfigDir();

    const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(this.xml).interfaces[0];
    this.dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
    this.dbusImpl.export(Gio.DBus.session, `/org/gnome/Shell/Extensions/${EXTENSION_NAME}`);

    this._loadAutoRestoreSetting();
    this._addPanelMenu();
    this._startAutoSave();
    this._startSuspendMonitor();
  }

  disable() {
    if (this.dbusImpl) {
      this.dbusImpl.unexport();
      this.dbusImpl = null;
    }
    if (this.button) {
      this.button.destroy();
      this.button = null;
    }
    this._stopAutoSave();
    this._stopSuspendMonitor();
  }
}
