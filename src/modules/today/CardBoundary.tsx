import { Component, type ReactNode } from 'react';

/** One card failing (a module bug, bad data) must not take the whole Today screen with it. */
export default class CardBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('Today card failed:', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card" role="alert">
        <div className="card-head"><strong>{this.props.title}</strong></div>
        <p className="muted" style={{ margin: 0 }}>This card could not be shown. The rest of Today still works.</p>
        <button className="link" onClick={() => this.setState({ failed: false })}>Try again</button>
      </section>
    );
  }
}
