import type { MouseEvent } from 'react';
import { GearIcon } from './icons';
import { linkClick } from '../puzzleInfo';
import './AboutPage.css';

const REQS: [string, string][] = [
  ['TSS / TSD / TST', 'a T-spin that clears 1 / 2 / 3 lines'],
  ['TETRIS', 'clear 4 lines at once'],
  ['PC', 'perfect clear — leave the board completely empty'],
  ['ATTACK', 'total garbage sent, using Puyo Puyo Tetris attack rules (b2b, combos and all)'],
  ['COMBO', 'highest combo reached (consecutive line-clearing pieces)'],
  ['NO HOLD', 'solve with hold disabled'],
];

interface AboutPageProps {
  onBrowse: () => void;
  onCreate: () => void;
  onOpenSettings: () => void;
}

export default function AboutPage({ onBrowse, onCreate, onOpenSettings }: AboutPageProps) {
  return (
    <div className="about-page">
      <section className="about-hero">
        <h1 className="about-title">WHAT'S PLONKTRIS?</h1>
        <p className="about-lead">
          plonktris is a tetris puzzle site. people build puzzles — a starting board, a fixed
          piece queue and a goal like "two T-spin doubles" or "perfect clear" — and everyone else
          tries to solve them. every solve is replayed and checked by the server, so the solve
          counts and the leaderboard are the real thing.
        </p>
      </section>

      <section className="about-section">
        <h2>solving a puzzle</h2>
        <ol className="about-steps">
          <li>pick a puzzle from the home page or <strong>search</strong>.</li>
          <li>place every piece in the queue and hit the goals shown above the board.</li>
          <li>
            there's no gravity and no time limit, so take your time. pieces only lock when you hard drop,
            and you can <strong>undo</strong> or <strong>restart</strong> whenever you like.
          </li>
          <li>log in and your solve is saved to your profile and the leaderboard. solve a puzzle
            before anyone else and you get a first solve ★.</li>
        </ol>
      </section>

      <section className="about-section">
        <h2>making a puzzle</h2>
        <ol className="about-steps">
          <li>in <strong>create</strong>, draw the starting board and type the piece queue (up to 30 pieces).</li>
          <li>set the goals in the side panel — at least one, plus no hold if you're feeling mean.</li>
          <li>hit <strong>test it</strong> and solve your own puzzle — every published puzzle has been solved at least once.</li>
          <li>once you've solved it, name it and <strong>publish</strong>. your draft is saved in
            this browser, so you can't lose it by refreshing or logging in.</li>
        </ol>
      </section>

      <section className="about-section">
        <h2>goals</h2>
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
        <h2>controls</h2>
        <p>
          move, rotate (cw, ccw and 180), soft drop, hard drop and hold with the keyboard. rotation is
          standard SRS. keys and handling (DAS, ARR, soft drop speed) are all adjustable under{' '}
          <button type="button" className="about-inline-btn" onClick={onOpenSettings}>
            <GearIcon className="btn-icon icon-gear" />settings
          </button>.
        </p>
      </section>

      <div className="about-cta">
        <a className="about-cta-btn" href="/" onClick={(e: MouseEvent) => linkClick(e, onBrowse)}>browse puzzles</a>
        <a className="about-cta-btn alt" href="/create" onClick={(e: MouseEvent) => linkClick(e, onCreate)}>make one</a>
      </div>
    </div>
  );
}
