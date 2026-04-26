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
        <DialogBody className="blocking-task-body">
          <DialogTitle className="blocking-task-title">
            <span aria-hidden="true" className="blocking-task-title-mark" />
            <span>{title}</span>
          </DialogTitle>
          <DialogContent className="blocking-task-dialog-content">
            <div className="blocking-task-content">
              {hasProgress ? (
                <>
                  <div className="blocking-task-status">
                    <Spinner size="tiny" />
                    <Text id="blocking-task-message">{message}</Text>
                  </div>
                  <ProgressBar
                    className="blocking-task-progress"
                    value={progress}
                    max={1}
                    thickness="medium"
                  />
                </>
              ) : (
                <div className="blocking-task-status">
                  <Spinner size="tiny" />
                  <Text>{message}</Text>
                </div>
              )}

              {currentStep ? (
                <div aria-live="polite" className="blocking-task-step">
                  <span aria-hidden="true" className="blocking-task-step-marker" />
                  <div>
                    <Text size={200}>Current step</Text>
                    <Text weight="semibold">{currentStep}</Text>
                  </div>
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
