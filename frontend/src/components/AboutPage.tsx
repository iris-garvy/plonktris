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
        <h1 className="about-title">WHAT'S PLONKTRIS?</h1>
        <p className="about-lead">
          plonktris is a tetris puzzle website where users can submit puzzles with complete privacy. plonktris validates that puzzles are 
          solvable but does not store solutions, so the creator maintains total control over the solution.
        </p>
      </section>

      <section className="about-section">
        <h2>creating a puzzle</h2>
        <ol className="about-steps">
          <li>in <strong>create</strong>, draw a starting board and set the piece queue.</li>
          <li>hit the <strong>prove</strong> button and set the requirements for the puzzle.</li>
          <li>prove your puzzle is solvable by solving it yourself.</li>
          <li>press the <strong>submit</strong> button. plonktris will generate a proof of solvability and publish it!</li>
        </ol>
      </section>

      <section className="about-section">
        <h2>solving a puzzle</h2>
        <ol className="about-steps">
          <li>open a puzzle from the home page or search.</li>
          <li>solve the puzzle by fulfilling the requirements</li>
          <li>
            when the requirements are met, hit <strong>submit</strong>. plonktris will generate a proof
            that you know a solution. if you're logged in, the solve is recorded
            on your profile.
          </li>
        </ol>
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
            <div className="about-mode-name"><CircleIcon className="btn-icon icon-fast" />fast (default)</div>
            <p>
              The server generates the proof. This is speedy (~10 seconds) 
              and is handled in the cloud so you can close your browser and check on its progress in your profile page.
            </p>
          </div>
          <div className="about-mode">
            <div className="about-mode-name"><LockIcon className="btn-icon icon-secure" />secure (slow)</div>
            <p>
              The browser generates the proof. This is quite a bit slower (~2 minutes) and you
              cannot leave the site while the proof is generating. You can turn this option on in your
              profile page.
            </p>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>controls</h2>
        <p>
          Move, rotate, hard/soft drop and hold with the keyboard. You can view
          and rebind everything from the <GearIcon className="btn-icon icon-gear" />button in the header.
        </p>
      </section>

      <div className="about-cta">
        <button className="about-cta-btn" onClick={onBrowse}>browse puzzles</button>
        <button className="about-cta-btn alt" onClick={onCreate}>create one</button>
      </div>
    </div>
  );
}
