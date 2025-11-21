import Meta from 'gi://Meta';

export class WindowCollector {
  static collect() {
    const windows = [];
    for (const actor of global.get_window_actors()) {
      const w = actor.meta_window;
      if (!w || w.get_window_type() !== Meta.WindowType.NORMAL) continue;

      const ws = w.get_workspace();
      const rect = w.get_frame_rect();

      windows.push({
        title: w.get_title(),
        workspace: ws ? ws.index() : -1,
        monitor: w.get_monitor(),
        wm_class: w.get_wm_class() || '',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
    return windows;
  }

  static findMatchingWindow(savedLayout) {
    const currentWindows = [];
    for (const actor of global.get_window_actors()) {
      const w = actor.meta_window;
      if (!w || w.get_window_type() !== Meta.WindowType.NORMAL) continue;

      const match = savedLayout.find(s =>
        s.wm_class === (w.get_wm_class() || '') &&
        s.title === w.get_title()
      );
      if (match) {
        currentWindows.push({window: w, layout: match});
      }
    }
    return currentWindows;
  }
}

export class WindowRestorer {
  static _isDisplaySystemReady() {
    try {
      return !!(global.workspace_manager && global.display);
    } catch (e) {
      console.error(`[SaveMyWindows] Error checking display system: ${String(e)}`);
      return false;
    }
  }

  static restoreWindow(window, layout) {
    try {
      if (layout.workspace >= 0) {
        const ws = global.workspace_manager.get_workspace_by_index(layout.workspace);
        if (ws) {
          window.change_workspace(ws);
        }
      }

      if (layout.monitor >= 0) {
        window.move_to_monitor(layout.monitor);
      }

      if (layout.x !== undefined && layout.y !== undefined &&
        layout.width !== undefined && layout.height !== undefined) {
        window.move_resize_frame(true, layout.x, layout.y, layout.width, layout.height);
      }

      return true;
    } catch (e) {
      console.error(`[SaveMyWindows] Error restoring window ${window.get_title()}: ${String(e)}`);
      return false;
    }
  }

  static async restore(savedLayout) {
    if (!this._isDisplaySystemReady()) {
      throw new Error('Display system not ready');
    }

    const windowsToRestore = WindowCollector.findMatchingWindow(savedLayout);
    let restoredCount = 0;

    for (const {window, layout} of windowsToRestore) {
      if (this.restoreWindow(window, layout)) {
        restoredCount++;
      }
    }

    return restoredCount;
  }
}
