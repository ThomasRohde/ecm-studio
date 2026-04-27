import { FullScreenMinimizeRegular, MaximizeRegular } from '@fluentui/react-icons';
import type { IDockviewHeaderActionsProps } from 'dockview';
import { useCallback, useEffect, useState } from 'react';

export function GroupHeaderActions({ api, containerApi }: IDockviewHeaderActionsProps) {
  const [isMaximized, setIsMaximized] = useState(() => api.isMaximized());
  const isPopout = api.location.type === 'popout';

  useEffect(() => {
    const disposable = containerApi.onDidMaximizedGroupChange(() => {
      setIsMaximized(api.isMaximized());
    });
    return () => disposable.dispose();
  }, [api, containerApi]);

  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      api.exitMaximized();
    } else {
      api.maximize();
    }
  }, [api, isMaximized]);

  if (isPopout) return null;

  return (
    <div className="group-header-actions">
      <button
        aria-label={isMaximized ? 'Restore view' : 'Maximize view'}
        className="group-header-action-button"
        onClick={toggleMaximize}
        title={isMaximized ? 'Restore view' : 'Maximize view'}
        type="button"
      >
        {isMaximized ? <FullScreenMinimizeRegular /> : <MaximizeRegular />}
      </button>
    </div>
  );
}
