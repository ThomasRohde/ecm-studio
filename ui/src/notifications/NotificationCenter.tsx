import {
  Button,
  CounterBadge,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer,
  Text,
  Tooltip,
} from '@fluentui/react-components';
import {
  AlertRegular,
  CheckmarkCircleRegular,
  DeleteRegular,
  DismissRegular,
  ErrorCircleRegular,
  InfoRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { runNotificationAction } from './notification-actions';
import type { NotificationRecord, ToastKind } from './notification-store';
import { useNotificationStore } from './notification-store';

function kindLabel(kind: ToastKind): string {
  if (kind === 'progress') return 'info';
  return kind;
}

function sourceLabel(notification: NotificationRecord): string {
  return notification.source ?? notification.intent.split('.')[0];
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function KindIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') return <CheckmarkCircleRegular />;
  if (kind === 'warning') return <WarningRegular />;
  if (kind === 'error') return <ErrorCircleRegular />;
  return <InfoRegular />;
}

export function NotificationCenterButton() {
  const unreadCount = useNotificationStore(
    (state) => state.notifications.filter((notification) => !notification.read).length,
  );
  const setCenterOpen = useNotificationStore((state) => state.setCenterOpen);

  return (
    <Tooltip content="Notifications" relationship="label">
      <Button
        appearance="subtle"
        aria-label="Open notifications"
        className="notification-button"
        icon={<AlertRegular />}
        onClick={() => setCenterOpen(true)}
      >
        {unreadCount > 0 ? (
          <CounterBadge
            appearance="filled"
            className="notification-counter"
            count={unreadCount}
            size="small"
          />
        ) : null}
      </Button>
    </Tooltip>
  );
}

export function NotificationCenter() {
  const notifications = useNotificationStore((state) => state.notifications);
  const centerOpen = useNotificationStore((state) => state.centerOpen);
  const setCenterOpen = useNotificationStore((state) => state.setCenterOpen);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const markRead = useNotificationStore((state) => state.markRead);
  const clearRead = useNotificationStore((state) => state.clearRead);
  const dismissNotification = useNotificationStore((state) => state.dismissNotification);
  const readCount = notifications.filter((notification) => notification.read).length;
  const unreadCount = notifications.length - readCount;

  return (
    <OverlayDrawer
      className="notification-drawer"
      open={centerOpen}
      position="end"
      onOpenChange={(_, data) => setCenterOpen(data.open)}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label="Close notifications"
              icon={<DismissRegular />}
              onClick={() => setCenterOpen(false)}
            />
          }
        >
          Notifications
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className="notification-center-toolbar">
          <Text size={200}>{unreadCount} unread</Text>
          <div className="toolbar">
            <Button disabled={unreadCount === 0} onClick={markAllRead}>
              Mark all read
            </Button>
            <Button disabled={readCount === 0} icon={<DeleteRegular />} onClick={clearRead}>
              Clear read
            </Button>
          </div>
        </div>

        {notifications.length === 0 ? (
          <Text>No notifications yet.</Text>
        ) : (
          <div className="notification-list">
            {notifications.map((notification) => (
              <article
                className={`notification-item ${notification.kind} ${notification.read ? 'read' : 'unread'}`}
                key={notification.id}
              >
                <div className="notification-item-icon" aria-hidden="true">
                  <KindIcon kind={notification.kind} />
                </div>
                <div className="notification-item-main">
                  <div className="notification-item-title-row">
                    <Text weight={notification.read ? 'regular' : 'semibold'}>
                      {notification.title}
                    </Text>
                    <span className="notification-kind">{kindLabel(notification.kind)}</span>
                  </div>
                  {notification.body ? <Text size={200}>{notification.body}</Text> : null}
                  <div className="notification-meta-row">
                    <span>{sourceLabel(notification)}</span>
                    <span>{formatTime(notification.updatedAt)}</span>
                    {notification.repeatCount > 1 ? (
                      <span>{notification.repeatCount} repeats</span>
                    ) : null}
                  </div>
                  {notification.action ? (
                    <Button
                      appearance="secondary"
                      size="small"
                      onClick={() => {
                        runNotificationAction(notification.action);
                        markRead(notification.id);
                        setCenterOpen(false);
                      }}
                    >
                      {notification.action.label}
                    </Button>
                  ) : null}
                </div>
                <Button
                  appearance="subtle"
                  aria-label={`Dismiss ${notification.title}`}
                  icon={<DismissRegular />}
                  onClick={() => dismissNotification(notification.id)}
                />
              </article>
            ))}
          </div>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}
