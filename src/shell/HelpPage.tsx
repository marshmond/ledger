import { openAddBox } from '../core/globalEvents';
import { PageHeader } from '../ui/components';
import { Icon } from '../ui/icons';
import Main from './Main';
import {
  CONNECT, EXAMPLES, HOUSEHOLD_AREAS, KIND_LABEL, STEPS, WELCOME, WHERE_TO,
  type HelpLink,
} from './helpContent';
import './help.css';

/** An address written as `/ledger/accounts` becomes a link the hash router follows. */
const href = (to: string) => `#${to}`;

const Links = ({ links }: { links: HelpLink[] }) => (
  <ul className="help-links">
    {links.map((l) => (
      <li key={l.path}><a href={href(l.path)}>{l.label}</a></li>
    ))}
  </ul>
);

/**
 * Getting Started & Help: one short, read-only page at `/help`. It reads and writes nothing (no database, no settings, no saved
 * "seen it" flag), so it opens the same way for a first-time user and for someone who has used Ledger for a year. The words live in
 * helpContent.ts; the only control that does anything is "Open the Add box", which opens the ordinary Add box and saves nothing itself.
 */
export default function HelpPage() {
  return (
    <div className="shell-main">
      <Main className="main">
        <div className="help">
          <PageHeader
            title="Getting Started & Help"
            description="A two-minute guide to what Ledger does, how to begin, and where things are."
          />

          <section className="help-sec" aria-labelledby="help-welcome">
            <h2 id="help-welcome">Welcome to Ledger</h2>
            <p className="help-lead">{WELCOME.lead}</p>
            {WELCOME.body.map((p) => <p key={p}>{p}</p>)}
          </section>

          <section className="help-sec" aria-labelledby="help-start">
            <h2 id="help-start">Getting started</h2>
            <ol className="help-steps">
              {STEPS.map((s) => (
                <li key={s.id} className="help-step">
                  <span className="help-ic" aria-hidden="true"><Icon name={s.icon} size={18} /></span>
                  <div className="help-step-body">
                    <h3>{s.title}</h3>
                    {s.body.map((p) => <p key={p}>{p}</p>)}
                    {s.id === 'household' && (
                      <ul className="help-areas">
                        {HOUSEHOLD_AREAS.map((a) => (
                          <li key={a.path}><a href={href(a.path)}>{a.label}</a><span className="help-hint">{a.hint}</span></li>
                        ))}
                      </ul>
                    )}
                    {s.addBox && (
                      <p><button type="button" className="btn" onClick={() => openAddBox()}>Open the Add box</button></p>
                    )}
                    {s.links && <Links links={s.links} />}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="help-sec" aria-labelledby="help-connect">
            <h2 id="help-connect">How everything connects</h2>
            <p className="help-lead">{CONNECT.lead}</p>
            <p>{CONNECT.intro}</p>
            <ul className="help-conn">
              {CONNECT.items.map((c) => (
                <li key={c.id}>
                  <div className="help-conn-head">
                    <strong>{c.from}</strong>
                    <span className="help-arrow" aria-hidden="true">→</span>
                    <span className="sr-only"> shows in </span>
                    <strong>{c.to}</strong>
                    <span className={`help-tag help-tag-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                  </div>
                  <p>{c.text}</p>
                </li>
              ))}
            </ul>
            <p className="help-note">{CONNECT.note}</p>
          </section>

          <section className="help-sec" aria-labelledby="help-where">
            <h2 id="help-where">Where do I go when…?</h2>
            <ul className="help-where">
              {WHERE_TO.map((w) => (
                <li key={w.id}>
                  <span className="help-need">{w.need}</span>
                  <Links links={w.links} />
                </li>
              ))}
            </ul>
          </section>

          <section className="help-sec" aria-labelledby="help-example">
            <details className="help-ex">
              <summary id="help-example"><span>{EXAMPLES.title}</span></summary>
              <p className="help-note">{EXAMPLES.intro}</p>
              {EXAMPLES.items.map((e) => (
                <div key={e.id} className="help-ex-item">
                  <h3>{e.title}</h3>
                  <p className="help-story">{e.story}</p>
                  <ol>{e.steps.map((st) => <li key={st}>{st}</li>)}</ol>
                  {e.note && <p className="help-note">{e.note}</p>}
                </div>
              ))}
            </details>
          </section>
        </div>
      </Main>
    </div>
  );
}
