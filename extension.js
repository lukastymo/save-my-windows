import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export default class WindowSaverExtension {
  constructor() {
    this.dbusImpl = null;
    this.layoutFile = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'window-layout.json']);
    this.autoSaveIntervalMins = 5; // Change if needed
    this.autoSaveTimeoutId = null;
    this.button = null;

    this.xml = `
        <node>
          <interface name="org.gnome.Shell.Extensions.WindowSaver">
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
    let result = [];
    for (let actor of global.get_window_actors()) {
      let w = actor.meta_window;
      if (!w) continue;
      let ws = w.get_workspace();
      let rect = w.get_frame_rect();
      result.push({
        title: w.get_title(),
        workspace: ws ? ws.index() : -1,
        monitor: w.get_monitor(),
        wm_class: w.get_wm_class() || "",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      });
    }
    return result;
  }

  ListWindows() {
    return JSON.stringify(this._collectWindows());
  }

  SaveLayout() {
    let data = JSON.stringify(this._collectWindows(), null, 2);
    GLib.file_set_contents(this.layoutFile, data);
    return `Saved ${this.layoutFile}`;
  }

  RestoreLayout() {
    try {
      let [ok, contents] = GLib.file_get_contents(this.layoutFile);
      if (!ok) throw new Error('Could not read layout file');
      let saved = JSON.parse(imports.byteArray.toString(contents));

      for (let actor of global.get_window_actors()) {
        let w = actor.meta_window;
        if (!w) continue;

        let match = saved.find(s =>
          s.wm_class === (w.get_wm_class() || "") &&
          s.title === w.get_title()
        );
        if (match) {
          if (match.workspace >= 0) {
            let ws = global.workspace_manager.get_workspace_by_index(match.workspace);
            if (ws) {
              w.change_workspace(ws);
            }
          }
          if (match.monitor >= 0) {
            w.move_to_monitor(match.monitor);
          }
          if (match.x !== undefined && match.y !== undefined) {
            w.move_resize_frame(
              true,
              match.x,
              match.y,
              match.width,
              match.height
            );
          }
        }
      }
      return `Restored from ${this.layoutFile}`;
    } catch (e) {
      return `Restore failed: ${e}`;
    }
  }

  _addPanelMenu() {
    this.button = new PanelMenu.Button(0.0, 'Window Saver', false);
    let icon = new St.Icon({
      icon_name: 'document-save-symbolic',
      style_class: 'system-status-icon'
    });
    this.button.add_child(icon);

    let saveItem = new PopupMenu.PopupMenuItem('Save Layout');
    saveItem.connect('activate', () => {
      this.SaveLayout();
      Main.notify('Window Saver', 'Layout saved.');
    });
    this.button.menu.addMenuItem(saveItem);

    let restoreItem = new PopupMenu.PopupMenuItem('Restore Layout');
    restoreItem.connect('activate', () => {
      this.RestoreLayout();
      Main.notify('Window Saver', 'Layout restored.');
    });
    this.button.menu.addMenuItem(restoreItem);

    Main.panel.addToStatusArea('window-saver', this.button);
  }

  _startAutoSave() {
    if (this.autoSaveTimeoutId) {
      GLib.source_remove(this.autoSaveTimeoutId);
    }
    this.autoSaveTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      this.autoSaveIntervalMins * 60,
      () => {
        this.SaveLayout();
        log(`[WindowSaver] Auto-saved layout`);
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
    // D-Bus
    const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(this.xml).interfaces[0];
    this.dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
    this.dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/WindowSaver');

    // UI
    this._addPanelMenu();

    // Auto-save
    this._startAutoSave();
  }

  disable() {
    // D-Bus
    if (this.dbusImpl) {
      this.dbusImpl.unexport();
      this.dbusImpl = null;
    }
    // UI
    if (this.button) {
      this.button.destroy();
      this.button = null;
    }
    // Auto-save
    this._stopAutoSave();
  }
}

