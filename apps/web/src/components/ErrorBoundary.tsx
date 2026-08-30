/**
 * `ErrorBoundary` (TASK-181) — the last line between a render crash and a
 * blank page (`specs/ux-states.md` §1, "never a blank page").
 *
 * ⚠ **A CLASS COMPONENT ON PURPOSE.** `componentDidCatch` /
 * `getDerivedStateFromError` have no hook equivalent in React 18; a function
 * component cannot catch a descendant's render error at all. This is the one
 * place in the SPA where a class is not a style choice.
 *
 * ⚠ **IT WRAPS THE `<Outlet />`, NOT THE WHOLE APP.** A boundary around the
 * root would take the header and nav down with the crashed screen, leaving
 * the owner with a message and no way to leave the page it is on. Wrapping
 * only the routed screen keeps every other route one tap away, which is a
 * better remedy than any button this component could render.
 *
 * ⚠ **RESET IS KEYED ON THE PATH.** Without `resetKey` the boundary latches:
 * navigating away renders a new route INTO the errored boundary and the owner
 * sees the same message on a screen that is fine. React does not clear
 * boundary state on its own.
 */

import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

import { BOUNDARY_BODY, BOUNDARY_RETRY_LABEL, BOUNDARY_TITLE } from '../copy';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /**
   * Changing this clears the error. The router path is the natural value:
   * "the owner went somewhere else" is exactly when a stale crash should stop
   * being shown.
   */
  readonly resetKey?: string;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
  readonly resetKey: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { failed: false, resetKey: props.resetKey };
  }

  public static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { failed: true };
  }

  /**
   * ⚠ Derived, not an effect. Clearing the error in `componentDidUpdate`
   * would render the crashed tree once more before the reset landed, and that
   * second render throws again — a loop the owner sees as a flicker.
   */
  public static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { failed: false, resetKey: props.resetKey };
    }
    return null;
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * ⚠ `console.error` ONLY. NFR: no telemetry, no analytics, no reporting
     * endpoint — a crash reporter here would be an outbound call the
     * dependency allow-list and `T-CI-007`'s egress guard both forbid, and
     * this is a single-owner app whose owner can read their own console.
     */
    console.error('nextup: a screen failed to render', error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  public override render(): JSX.Element {
    if (!this.state.failed) {
      return <>{this.props.children}</>;
    }

    return (
      <div className="boundary" role="alert">
        <h1>{BOUNDARY_TITLE}</h1>
        <p>{BOUNDARY_BODY}</p>
        <button type="button" className="tap-target" onClick={this.retry}>
          {BOUNDARY_RETRY_LABEL}
        </button>
      </div>
    );
  }
}
