import type { HTMLAttributes, ReactNode } from 'react';

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'title'
> {
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action, children, ...props }: EmptyStateProps) {
  return (
    <div {...props} className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="empty-state__title">{title}</div>
      {body}
      {children}
      {action}
    </div>
  );
}
