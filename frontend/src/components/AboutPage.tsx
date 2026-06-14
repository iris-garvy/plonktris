import { CircleIcon, LockIcon, GearIcon } from './icons';
import './AboutPage.css';

const REQS: [string, string][] = [
  ['TSS / TSD / TST', 'a T-spin that clears 1 / 2 / 3 lines'],
  ['TETRIS', 'clear 4 lines at once'],
  ['PC', 'perfect clear'],
  ['ATTACK', 'total garbage sent, plonktris uses Puyo Puyo Tetris guidelines'],
  ['COMBO', 'highest combo reached'],
  ['NO HOLD', 'solve with hold disabled'],
];

interface AboutPageProps {
  onBrowse: () => void;
  onCreate: () => void;
}

export default function AboutPage({ onBrowse, onCreate }: AboutPageProps) {
  return (
    <div className="about-page">
      <section className="about-hero">
        <h1 className="about-title">what's plonktris?</h1>
        <p className="about-lead">
          Plonktris is a tetris puzzle website where users can submit puzzles with complete privacy. Plonktris validates that puzzles are 
          solvable but does not store solutions, so the creator maintains total control over the solution.
        </p>
      </section>

      <section className="about-section">
        <h2>creating a puzzle</h2>
        <ol className="about-steps">
          <li>In <strong>create</strong>, draw a starting board and set the piece queue.</li>
          <li>Choose the requirements a solver must hit.</li>
          <li>
            Solve it yourself to prove it's possible — that solution is what gets
            published. You'll need an account to publish.
          </li>
        </ol>
      </section>

      <section className="about-section">
        <h2>solving a puzzle</h2>
        <ol className="about-steps">
          <li>Open a puzzle from the home page or search.</li>
          <li>Place the queued pieces to satisfy the puzzle's requirements.</li>
          <li>
            When the requirements are met, hit <strong>submit</strong> — a proof
            is generated and checked. If you're logged in, the solve is recorded
            on your profile (and you might grab the <em>first solve</em>).
          </li>
        </ol>
        <p className="about-note">
          Anonymous solving works too, but it isn't recorded — log in if you want
          credit.
        </p>
      </section>

      <section className="about-section">
        <h2>requirements</h2>
        <dl className="about-reqs">
          {REQS.map(([name, desc]) => (
            <div className="about-req" key={name}>
              <dt>{name}</dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="about-section">
        <h2>fast vs. secure proving</h2>
        <div className="about-modes">
          <div className="about-mode">
            <div className="about-mode-name"><CircleIcon className="btn-icon" />fast (default)</div>
            <p>
              The server generates the proof. Quick, and you can close the tab —
              the result shows up on your profile when it's done.
            </p>
          </div>
          <div className="about-mode">
            <div className="about-mode-name"><LockIcon className="btn-icon" />secure (slow)</div>
            <p>
              Your browser generates the proof, so your solution never leaves your
              device — truly zero-knowledge. It's slower and you must keep the tab
              open. Turn it on under settings on your profile.
            </p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>controls</h2>
        <p>
          Move, rotate, hard/soft drop and hold with the keyboard. You can view
          and rebind everything from the <GearIcon className="btn-icon" /> button in the header.
        </p>
      </section>

      <div className="about-cta">
        <button className="about-cta-btn" onClick={onBrowse}>browse puzzles</button>
        <button className="about-cta-btn alt" onClick={onCreate}>create one</button>
      </div>
    </div>
  );
}
