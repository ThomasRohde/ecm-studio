import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  ProgressBar,
  Spinner,
  Text,
} from '@fluentui/react-components';
import { useBlockingTaskStore } from './blocking-task-store';

export function BlockingTaskDialog() {
  const open = useBlockingTaskStore((state) => state.open);
  const title = useBlockingTaskStore((state) => state.title);
  const message = useBlockingTaskStore((state) => state.message);
  const currentStep = useBlockingTaskStore((state) => state.currentStep);
  const progress = useBlockingTaskStore((state) => state.progress);
  const details = useBlockingTaskStore((state) => state.details);
  const kind = useBlockingTaskStore((state) => state.kind);
  const hasProgress = typeof progress === 'number';

  return (
    <Dialog open={open} modalType="alert">
      <DialogSurface className={`blocking-task-surface ${kind ?? 'default'}`}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div className="blocking-task-content">
              {hasProgress ? (
                <>
                  <Text id="blocking-task-message">{message}</Text>
                  <ProgressBar value={progress} max={1} thickness="medium" />
                </>
              ) : (
                <Spinner label={message} labelPosition="after" />
              )}

              {currentStep ? (
                <div className="blocking-task-step">
                  <Text size={200}>Current step</Text>
                  <Text weight="semibold">{currentStep}</Text>
                </div>
              ) : null}

              {details ? (
                <details className="blocking-task-details">
                  <summary>Details</summary>
                  <pre>{details}</pre>
                </details>
              ) : null}
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
