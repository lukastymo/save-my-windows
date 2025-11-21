import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {LayoutStorage, SettingsStorage} from './modules/storage.js';
import {WindowCollector, WindowRestorer} from './modules/windows.js';
import {SuspendMonitor} from './modules/suspend.js';
import {UIManager} from './modules/ui.js';

const EXTENSION_NAME = "SaveMyWindows";
const AUTO_SAVE_INTERVAL_MINS = 5;

export default class SaveMyWindowsExtension {
  constructor() {
    this.dbusImpl = null;
    this.autoSaveTimeoutId = null;
    this.ui = null;
    this.suspendMonitor = null;
    this.autoRestoreAfterSuspend = false;

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

  ListWindows() {
    return JSON.stringify(WindowCollector.collect());
  }

  SaveLayout() {
    const layout = WindowCollector.collect();
    LayoutStorage.save(layout);
    return 'Layout saved';
  }

  RestoreLayout() {
    LayoutStorage.load().then(savedLayout => {
      if (!savedLayout) {
        this.ui.notify('No saved layout found');
        return;
      }

      WindowRestorer.restore(savedLayout)
        .then(count => {
          this.ui.notify(`Restored ${count} windows`);
        })
        .catch(error => {
          console.error(`[${EXTENSION_NAME}] Restore failed: ${error}`);
          this.ui.notify(`Restore failed: ${error.message}`);
        });
    });

    return 'Restore started';
  }

  saveLayout() {
    this.SaveLayout();
  }

  async restoreLayout() {
    try {
      const savedLayout = await LayoutStorage.load();
      if (!savedLayout) {
        this.ui.notify('No saved layout found');
        return;
      }

      const count = await WindowRestorer.restore(savedLayout);
      this.ui.notify(`Restored ${count} windows`);
    } catch (error) {
      console.error(`[${EXTENSION_NAME}] Restore failed: ${error}`);
      this.ui.notify(`Restore failed: ${error.message}`);
    }
  }

  setAutoRestoreAfterSuspend(enabled) {
    this.autoRestoreAfterSuspend = enabled;
    this._saveAutoRestoreSetting();

    if (enabled) {
      this.suspendMonitor.start();
      this.ui.notify('Auto-restore after suspend enabled.');
    } else {
      this.suspendMonitor.stop();
      this.ui.notify('Auto-restore after suspend disabled.');
    }
  }

  _startAutoSave() {
    if (this.autoSaveTimeoutId) {
      GLib.source_remove(this.autoSaveTimeoutId);
    }

    this.autoSaveTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      AUTO_SAVE_INTERVAL_MINS * 60,
      () => {
        this.SaveLayout();
        console.log(`[${EXTENSION_NAME}] Auto-saved layout`);
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

  _loadAutoRestoreSetting() {
    SettingsStorage.load((settings) => {
      this.autoRestoreAfterSuspend = settings.autoRestoreAfterSuspend || false;
      if (this.autoRestoreAfterSuspend) {
        this.suspendMonitor.start();
      }
    });
  }

  _saveAutoRestoreSetting() {
    SettingsStorage.load((settings) => {
      settings.autoRestoreAfterSuspend = this.autoRestoreAfterSuspend;
      SettingsStorage.save(settings);
    });
  }

  enable() {
    const ifaceInfo = Gio.DBusNodeInfo.new_for_xml(this.xml).interfaces[0];
    this.dbusImpl = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, this);
    this.dbusImpl.export(Gio.DBus.session, `/org/gnome/Shell/Extensions/${EXTENSION_NAME}`);

    this.ui = new UIManager(this);
    this.ui.createPanelMenu();

    this.suspendMonitor = new SuspendMonitor(() => {
      this.restoreLayout();
      this.ui.notify('Layout restored after suspend.');
    });

    this._loadAutoRestoreSetting();
    this._startAutoSave();
  }

  disable() {
    if (this.dbusImpl) {
      this.dbusImpl.unexport();
      this.dbusImpl = null;
    }

    if (this.ui) {
      this.ui.destroy();
      this.ui = null;
    }

    if (this.suspendMonitor) {
      this.suspendMonitor.stop();
      this.suspendMonitor = null;
    }

    this._stopAutoSave();
  }
}
