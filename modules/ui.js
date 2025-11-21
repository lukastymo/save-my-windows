import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class UIManager {
  constructor(extension) {
    this.extension = extension;
    this.button = null;
  }

  createPanelMenu() {
    this.button = new PanelMenu.Button(0.0, 'Save My Windows', false);

    const icon = new St.Icon({
      icon_name: 'document-save-symbolic',
      style_class: 'system-status-icon',
    });
    this.button.add_child(icon);

    const saveItem = new PopupMenu.PopupMenuItem('Save Layout');
    saveItem.connect('activate', () => {
      this.extension.saveLayout();
      this.notify('Layout saved.');
    });
    this.button.menu.addMenuItem(saveItem);

    const restoreItem = new PopupMenu.PopupMenuItem('Restore Layout');
    restoreItem.connect('activate', () => {
      this.extension.restoreLayout();
      this.notify('Layout restored.');
    });
    this.button.menu.addMenuItem(restoreItem);

    this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const autoRestoreItem = new PopupMenu.PopupSwitchMenuItem(
      'Restore automatically after suspend',
      this.extension.autoRestoreAfterSuspend
    );
    autoRestoreItem.connect('toggled', (item, state) => {
      this.extension.setAutoRestoreAfterSuspend(state);
    });
    this.button.menu.addMenuItem(autoRestoreItem);

    Main.panel.addToStatusArea('save-my-windows', this.button);
  }

  notify(message) {
    Main.notify('Save My Windows', message);
  }

  destroy() {
    if (this.button) {
      this.button.destroy();
      this.button = null;
    }
  }
}
