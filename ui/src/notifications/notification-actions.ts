import { useLayoutStore } from '../store/layout-store';
import type { NotificationAction } from './notification-store';

export function runNotificationAction(action: NotificationAction | undefined): void {
  if (!action) return;
  if ('panelId' in action) {
    useLayoutStore.getState().openPanel(action.panelId);
    return;
  }
  action.run();
}
