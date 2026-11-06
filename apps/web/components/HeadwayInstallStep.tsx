'use client';

import Link from 'next/link';
import { HeadwayToggle, useHeadway } from './HeadwayProvider';

type Props = { onBack: () => void; onReview: () => void; savedSamples: number; recognitionAccepted: boolean };

export function HeadwayInstallStep({ onBack, onReview, savedSamples, recognitionAccepted }: Props) {
  const { phase, detected } = useHeadway();
  return <div className="hi-onboarding" data-testid="headway-install-step">
    <header className="hi-heading">
      <div className="hi-heading-icon" aria-hidden="true">✚</div>
      <div>
        <p className="step-kicker">Step 5 of 5</p>
        <h2>Your personalized experience</h2>
        <p className="hi-intro">Your voice setup journey has reached its final step. Launch a practical accessible workspace and choose which controls you want to use.</p>
      </div>
    </header>

    <div className="hi-feature-grid">
      <section className="hi-start-card" aria-labelledby="hi-launch-heading">
        <h3 id="hi-launch-heading">Ready to explore?</h3>
        <p>Try safe, interactive reading, shopping and form experiences. Headway is optional and can assist you before, during and after onboarding.</p>
        <div className="hi-launch-actions">
          <Link className="hi-download-button hi-launch-button" href="/workspace">
            <span aria-hidden="true">✚</span><span>Launch My Accessible Workspace</span><span aria-hidden="true">↗</span>
          </Link>
          <HeadwayToggle />
        </div>
        <div className="hi-flow" aria-label="Your accessible experience">
          <div className="hi-flow-item"><span className="hi-flow-icon" aria-hidden="true">◉</span><strong>Choose controls</strong><small>Voice, Headway or ordinary input</small></div>
          <span className="hi-flow-arrow" aria-hidden="true">→</span>
          <div className="hi-flow-item"><span className="hi-flow-icon" aria-hidden="true">▣</span><strong>Calibrate</strong><small>Only if you enable Headway</small></div>
          <span className="hi-flow-arrow" aria-hidden="true">→</span>
          <div className="hi-flow-item"><span className="hi-flow-icon" aria-hidden="true">✦</span><strong>Explore</strong><small>Try real page actions</small></div>
        </div>
      </section>
      <div className="hi-preview">
        <div className="hi-preview-window">
          <div className="hi-preview-topbar"><div className="hi-preview-brand"><span className="hi-preview-logo">✚</span><strong>Your accessibility toolkit</strong></div></div>
          <div className="hi-preview-line"><span className="hi-preview-setting-icon">◉</span><span className="hi-preview-setting-text"><strong>Voice samples</strong><small>{savedSamples > 0 ? savedSamples + ' sample(s) saved' : 'No samples saved yet'}</small></span><span>{savedSamples > 0 ? '✓' : '○'}</span></div>
          <div className="hi-preview-line"><span className="hi-preview-setting-icon">⌁</span><span className="hi-preview-setting-text"><strong>Recognition</strong><small>{recognitionAccepted ? 'A command was accepted' : 'No accepted command confirmed yet'}</small></span></div>
          <div className="hi-preview-line"><span className="hi-preview-setting-icon">✥</span><span className="hi-preview-setting-text"><strong>Headway website demo</strong><small>{phase === 'active' ? detected ? 'Tracking one face' : 'Awaiting a face' : phase === 'off' ? 'Optional · Off' : phase}</small></span></div>
        </div>
        <span className="hi-preview-sparkle hi-preview-sparkle-a">✦</span>
      </div>
    </div>

    <div className="hi-benefits">
      <section className="hi-benefit-card" aria-labelledby="hi-web-demo-heading">
        <h3 id="hi-web-demo-heading">Headway can start at any step</h3>
        <p>Enable Headway from the header, grant camera permission, and calibrate your head position. The controls are also available in the workspace. Your camera is off by default.</p>
      </section>
      <section className="hi-benefit-card hi-after-card" aria-labelledby="hi-future-extension-heading">
        <h3 id="hi-future-extension-heading">Beyond this website</h3>
        <p>This browser demonstration operates only within Sauti Adapt. The separate Chrome extension is being developed for permitted external websites.</p>
        <Link href="/install" className="hi-full-guide-link">About future Chrome extension distribution</Link>
      </section>
    </div>
    <div className="hi-bottom-actions">
      <button type="button" className="hi-back-button" onClick={onBack}>← Back to recognition</button>
      <button type="button" className="hi-review-button" onClick={onReview}>Review setup</button>
    </div>
  </div>;
}
