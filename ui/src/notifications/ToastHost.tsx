import { useEffect, useMemo, useRef } from 'react';
import {
  Button,
  Toast,
  ToastBody,
  ToastFooter,
  ToastTitle,
  Toaster,
  useToastController,
} from '@fluentui/react-components';
import type { ToastIntent as FluentToastIntent } from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  CheckmarkCircleRegular,
  ErrorCircleRegular,
  InfoRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { runNotificationAction } from './notification-actions';
import {
  notificationTimeoutMs,
  selectToastStack,
  useNotificationStore,
} from './notification-store';
import type { NotificationRecord, ToastKind } from './notification-store';

const TOASTER_ID = 'ecms-notifications';
const OVERFLOW_TOAST_ID = 'ecms-notification-overflow';

function fluentIntent(kind: ToastKind): FluentToastIntent {
  if (kind === 'progress') return 'info';
  return kind;
}

function KindIcon({ kind }: { kind: ToastKind }) {
  if (kind === 'success') return <CheckmarkCircleRegular />;
  if (kind === 'warning') return <WarningRegular />;
  if (kind === 'error') return <ErrorCircleRegular />;
  if (kind === 'progress') return <ArrowClockwiseRegular />;
  return <InfoRegular />;
}

function NotificationToast({ notification }: { notification: NotificationRecord }) {
  return (
    <Toast>
      <ToastTitle media={<KindIcon kind={notification.kind} />}>
        {notification.title}
      </ToastTitle>
      {notification.body ? <ToastBody>{notification.body}</ToastBody> : null}
      {notification.action ? (
        <ToastFooter>
          <Button
            appearance="transparent"
            size="small"
            onClick={() => runNotificationAction(notification.action)}
          >
            {notification.action.label}
          </Button>
        </ToastFooter>
      ) : null}
    </Toast>
  );
}

function OverflowToast({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <Toast>
      <ToastTitle media={<InfoRegular />}>{count} more events</ToastTitle>
      <ToastBody>Open the notification center to review the full activity list.</ToastBody>
      <ToastFooter>
        <Button appearance="transparent" size="small" onClick={onOpen}>
          Open notifications
        </Button>
      </ToastFooter>
    </Toast>
  );
}

export function ToastHost() {
  const notifications = useNotificationStore((state) => state.notifications);
  const markToastDismissed = useNotificationStore((state) => state.markToastDismissed);
  const setCenterOpen = useNotificationStore((state) => state.setCenterOpen);
  const stack = useMemo(() => selectToastStack(notifications), [notifications]);
  const { dispatchToast, dismissToast, updateToast } = useToastController(TOASTER_ID);
  const renderedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const expectedIds = new Set(stack.visible.map((notification) => notification.id));
    if (stack.overflowCount > 0) expectedIds.add(OVERFLOW_TOAST_ID);

    for (const id of renderedIds.current) {
      if (!expectedIds.has(id)) dismissToast(id);
    }

    for (const notification of stack.visible) {
      const content = <NotificationToast notification={notification} />;
      const options = {
        toastId: notification.id,
        intent: fluentIntent(notification.kind),
        timeout: notificationTimeoutMs(notification),
        onStatusChange: (_: null, data: { status: string }) => {
          if (data.status === 'dismissed') markToastDismissed(notification.id);
        },
      };

      if (renderedIds.current.has(notification.id)) {
        updateToast({ ...options, content });
      } else {
        dispatchToast(content, options);
      }
    }

    if (stack.overflowCount > 0) {
      const content = (
        <OverflowToast count={stack.overflowCount} onOpen={() => setCenterOpen(true)} />
      );
      const options = {
        toastId: OVERFLOW_TOAST_ID,
        intent: 'info' as FluentToastIntent,
        timeout: -1,
      };
      if (renderedIds.current.has(OVERFLOW_TOAST_ID)) {
        updateToast({ ...options, content });
      } else {
        dispatchToast(content, options);
      }
    }

    renderedIds.current = expectedIds;
  }, [
    dismissToast,
    dispatchToast,
    markToastDismissed,
    setCenterOpen,
    stack.overflowCount,
    stack.visible,
    updateToast,
  ]);

  return (
    <Toaster
      toasterId={TOASTER_ID}
      position="bottom-end"
      offset={{ horizontal: 20, vertical: 46 }}
      limit={3}
      pauseOnHover
      pauseOnWindowBlur
    />
  );
}
