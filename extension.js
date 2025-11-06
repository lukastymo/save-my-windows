// noinspection JSUnresolvedVariable,JSUnresolvedFunction
/* eslint-disable no-undef */
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

function loadSettings(callback) {
  ensureConfigDir();
  const file = Gio.File.new_for_path(SETTINGS_FILE);

  file.load_contents_async(null, (file, result) => {
    try {
      const [ok, contents] = file.load_contents_finish(result);
      if (!ok) {
        callback({});
        return;
      }

      const decoder = new TextDecoder();
      const settings = JSON.parse(decoder.decode(contents));
      callback(settings);
    } catch (e) {
      callback({});
    }
  });
}

function saveSettings(settings) {
  try {
    ensureConfigDir();
    const data = JSON.stringify(settings, null, 2);
    GLib.file_set_contents(SETTINGS_FILE, data);
  } catch (e) {
    console.error(`[${EXTENSION_NAME}] Failed to save settings: ${String(e)}`);
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
    this.restoreTimeouts = [];
    this.suspendTimeouts = [];

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

  _addRestoreTimeout(delayMs, callback) {
    const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
      callback();
      this.restoreTimeouts = this.restoreTimeouts.filter(id => id !== timeoutId);
      return GLib.SOURCE_REMOVE;
    });
    this.restoreTimeouts.push(timeoutId);
  }

  _addSuspendTimeout(delaySeconds, callback) {
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySeconds, () => {
      callback();
      this.suspendTimeouts = this.suspendTimeouts.filter(id => id !== timeoutId);
      return GLib.SOURCE_REMOVE;
    });
    this.suspendTimeouts.push(timeoutId);
  }

  _clearRestoreTimeouts() {
    this.restoreTimeouts.forEach(id => GLib.source_remove(id));
    this.restoreTimeouts = [];
  }

  _clearSuspendTimeouts() {
    this.suspendTimeouts.forEach(id => GLib.source_remove(id));
    this.suspendTimeouts = [];
  }

  RestoreLayout() {
    try {
      ensureConfigDir();

      if (!this._isDisplaySystemReady()) {
        console.warn(`[${EXTENSION_NAME}] Display system not ready, aborting restore`);
        return `Display system not ready`;
      }

      this._clearRestoreTimeouts();

      const file = Gio.File.new_for_path(LAYOUT_FILE);
      file.load_contents_async(null, (file, result) => {
        try {
          const [ok, contents] = file.load_contents_finish(result);
          if (!ok) {
            console.warn(`[${EXTENSION_NAME}] Layout file not found: ${LAYOUT_FILE}`);
            Main.notify('Save My Windows', 'No saved layout found');
            return;
          }

          const decoder = new TextDecoder();
          const saved = JSON.parse(decoder.decode(contents));
          console.log(`[${EXTENSION_NAME}] Loaded ${saved.length} saved windows`);

          let restoredCount = 0;
          for (const actor of global.get_window_actors()) {
            const w = actor.meta_window;
            if (!w || w.get_window_type() !== Meta.WindowType.NORMAL) continue;

            const match = saved.find(s =>
              s.wm_class === (w.get_wm_class() || '') &&
              s.title === w.get_title()
            );
            if (!match) continue;

            console.log(`[${EXTENSION_NAME}] Restoring window: ${w.get_title()}`);

            this._addRestoreTimeout(100, () => {
              if (match.workspace >= 0 && this._isDisplaySystemReady()) {
                const ws = global.workspace_manager.get_workspace_by_index(match.workspace);
                if (ws) {
                  console.log(`[${EXTENSION_NAME}] Moving to workspace ${match.workspace}`);
                  try {
                    w.change_workspace(ws);
                  } catch (e) {
                    console.error(`[${EXTENSION_NAME}] Error moving to workspace: ${String(e)}`);
                  }
                }
              }
            });

            this._addRestoreTimeout(200, () => {
              if (match.monitor >= 0 && this._isDisplaySystemReady()) {
                console.log(`[${EXTENSION_NAME}] Moving to monitor ${match.monitor}`);
                try {
                  w.move_to_monitor(match.monitor);
                } catch (e) {
                  console.error(`[${EXTENSION_NAME}] Error moving to monitor: ${String(e)}`);
                }
              }
            });

            this._addRestoreTimeout(300, () => {
              if (match.x !== undefined && match.y !== undefined &&
                match.width !== undefined && match.height !== undefined &&
                this._isDisplaySystemReady()) {
                console.log(`[${EXTENSION_NAME}] Resizing to ${match.x},${match.y} ${match.width}x${match.height}`);
                try {
                  w.move_resize_frame(true, match.x, match.y, match.width, match.height);
                } catch (e) {
                  console.error(`[${EXTENSION_NAME}] Error resizing window: ${String(e)}`);
                }
              }
            });

            restoredCount++;
          }

          console.log(`[${EXTENSION_NAME}] Restored ${restoredCount} windows`);
          Main.notify('Save My Windows', `Restored ${restoredCount} windows`);
        } catch (e) {
          console.error(`[${EXTENSION_NAME}] Restore failed: ${String(e)}`);
          Main.notify('Save My Windows', `Restore failed: ${String(e)}`);
        }
      });

      return `Restore started`;
    } catch (e) {
      console.error(`[${EXTENSION_NAME}] Restore failed: ${String(e)}`);
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
      console.log(`[${EXTENSION_NAME}] User clicked manual restore layout`);
      const result = this.RestoreLayout();
      console.log(`[${EXTENSION_NAME}] Manual restore result: ${result}`);
      Main.notify('Save My Windows', 'Layout restored.');
    });
    this.button.menu.addMenuItem(restoreItem);

    this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const autoRestoreItem = new PopupMenu.PopupSwitchMenuItem('Restore automatically after suspend', this.autoRestoreAfterSuspend);
    autoRestoreItem.connect('toggled', (item, state) => {
      this.autoRestoreAfterSuspend = state;
      this._saveAutoRestoreSetting();
      if (state) {
        console.log(`[${EXTENSION_NAME}] User enabled auto-restore after suspend`);
        this._startSuspendMonitor();
        Main.notify('Save My Windows', 'Auto-restore after suspend enabled.');
      } else {
        console.log(`[${EXTENSION_NAME}] User disabled auto-restore after suspend`);
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
        console.log(`[${EXTENSION_NAME}] Auto-saved layout to ${LAYOUT_FILE}`);
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
    if (!this.autoRestoreAfterSuspend) {
      console.log(`[${EXTENSION_NAME}] Auto-restore after suspend is disabled, skipping suspend monitor`);
      return;
    }

    this._clearSuspendTimeouts();

    console.log(`[${EXTENSION_NAME}] Starting suspend monitor...`);
    try {
      this.suspendMonitor = new Gio.DBusProxy({
        g_connection: Gio.DBus.system,
        g_name: 'org.freedesktop.login1',
        g_object_path: '/org/freedesktop/login1',
        g_interface_name: 'org.freedesktop.login1.Manager',
        g_flags: Gio.DBusProxyFlags.NONE
      });

      this.suspendMonitor.connect('g-signal', (proxy, sender, signal, parameters) => {
        console.log(`[${EXTENSION_NAME}] Received D-Bus signal: ${signal}`);
        if (signal === 'PrepareForSleep') {
          const [sleeping] = parameters.deep_unpack();
          console.log(`[${EXTENSION_NAME}] PrepareForSleep signal: sleeping=${sleeping}`);
          if (!sleeping) {
            console.log(`[${EXTENSION_NAME}] System resumed from suspend, restoring layout...`);
            this._addSuspendTimeout(10, () => {
              console.log(`[${EXTENSION_NAME}] About to restore layout after suspend...`);

              if (!this._isDisplaySystemReady()) {
                console.warn(`[${EXTENSION_NAME}] Display system not ready, delaying restore...`);
                this._addSuspendTimeout(5, () => {
                  const result = this.RestoreLayout();
                  console.log(`[${EXTENSION_NAME}] Delayed restore result: ${result}`);
                  Main.notify('Save My Windows', 'Layout restored after suspend.');
                });
                return;
              }

              const result = this.RestoreLayout();
              console.log(`[${EXTENSION_NAME}] Restore result: ${result}`);
              Main.notify('Save My Windows', 'Layout restored after suspend.');
            });
          }
        }
      });

      this.suspendMonitor.init(null);
      console.log(`[${EXTENSION_NAME}] Suspend monitor started successfully`);
    } catch (e) {
      console.error(`[${EXTENSION_NAME}] Failed to start suspend monitor: ${String(e)}`);
    }
  }

  _stopSuspendMonitor() {
    this._clearSuspendTimeouts();

    if (this.suspendMonitor) {
      try {
        this.suspendMonitor.disconnect('g-signal');
      } catch (e) {
        console.error(`[${EXTENSION_NAME}] Error disconnecting suspend monitor: ${String(e)}`);
      }
      this.suspendMonitor = null;
    }
  }

  _isDisplaySystemReady() {
    try {
      if (!global.workspace_manager) {
        console.log(`[${EXTENSION_NAME}] Workspace manager not ready`);
        return false;
      }

      if (!global.display) {
        console.log(`[${EXTENSION_NAME}] Display not ready`);
        return false;
      }

      console.log(`[${EXTENSION_NAME}] Display system is ready`);
      return true;
    } catch (e) {
      console.error(`[${EXTENSION_NAME}] Error checking display system: ${String(e)}`);
      return false;
    }
  }

  _saveAutoRestoreSetting() {
    loadSettings((settings) => {
      settings.autoRestoreAfterSuspend = this.autoRestoreAfterSuspend;
      saveSettings(settings);
    });
  }

  _loadAutoRestoreSetting() {
    loadSettings((settings) => {
      this.autoRestoreAfterSuspend = settings.autoRestoreAfterSuspend || false;
    });
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
    this._clearRestoreTimeouts();
    this._stopSuspendMonitor();
  }
}
