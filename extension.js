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

const AUTO_SAVE_INTERVAL_MINS = 5;

function ensureConfigDir() {
  if (!GLib.file_test(CONFIG_DIR, GLib.FileTest.IS_DIR)) {
    Gio.File.new_for_path(CONFIG_DIR).make_directory_with_parents(null);
  }
}

export default class SaveMyWindowsExtension {
  constructor() {
    this.dbusImpl = null;
    this.autoSaveIntervalMins = AUTO_SAVE_INTERVAL_MINS;
    this.autoSaveTimeoutId = null;
    this.button = null;

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
    return `Saved ${LAYOUT_FILE}`;
  }

  RestoreLayout() {
    try {
      ensureConfigDir();

      const [ok, contents] = GLib.file_get_contents(LAYOUT_FILE);
      if (!ok) throw new Error('Could not read layout file');

      const saved = JSON.parse(imports.byteArray.toString(contents));

      for (const actor of global.get_window_actors()) {
        const w = actor.meta_window;
        if (!w || w.get_window_type() !== Meta.WindowType.NORMAL) continue;

        const match = saved.find(s =>
          s.wm_class === (w.get_wm_class() || '') &&
          s.title === w.get_title()
        );
        if (!match) continue;

        if (match.workspace >= 0) {
          const ws = global.workspace_manager.get_workspace_by_index(match.workspace);
          if (ws) w.change_workspace(ws);
        }
        if (match.monitor >= 0) {
          w.move_to_monitor(match.monitor);
        }
        if (match.x !== undefined && match.y !== undefined &&
          match.width !== undefined && match.height !== undefined) {
          w.move_resize_frame(true, match.x, match.y, match.width, match.height);
        }
      }
      return `Restored from ${LAYOUT_FILE}`;
    } catch (e) {
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
      this.RestoreLayout();
      Main.notify('Save My Windows', 'Layout restored.');
    });
    this.button.menu.addMenuItem(restoreItem);

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

  enable() {
    ensureConfigDir();

    const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(this.xml).interfaces[0];
    this.dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
    this.dbusImpl.export(Gio.DBus.session, `/org/gnome/Shell/Extensions/${EXTENSION_NAME}`);

    this._addPanelMenu();
    this._startAutoSave();
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
  }
}
