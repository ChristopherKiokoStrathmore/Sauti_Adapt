'use client';

import { getHeadwayStoreUrl } from '@/lib/headway-store';

type Props = {
  onBack: () => void;
  onReview: () => void;
};

export function HeadwayInstallStep({ onBack, onReview }: Props) {
  const storeUrl = getHeadwayStoreUrl();

  return (
    <div className="hi-onboarding" data-testid="headway-install-step">
      <header className="hi-heading">
        <div className="hi-heading-icon" aria-hidden="true">✚</div>
        <div>
          <p className="step-kicker">Step 5 of 5</p>
          <h2>Install Headway extension</h2>
          <p className="hi-intro">Add hands free browsing with head movement and mouth gestures. When Chrome Web Store publishing is complete, install Headway directly in desktop Chrome, then follow the guided setup.</p>
        </div>
      </header>

      <div className="hi-feature-grid">
        <section className="hi-start-card" aria-label="Install Headway on Chrome">
          <div className="hi-download-row">
            {storeUrl ? (
              <a className="hi-download-button" href={storeUrl} target="_blank" rel="noopener noreferrer" aria-label="Install Headway from Chrome Web Store">
                <span className="hi-chrome-symbol" aria-hidden="true"><span/></span>
                <span>Install extension</span>
                <span className="hi-download-arrow" aria-hidden="true">↗</span>
              </a>
            ) : (
              <div className="hi-download-button hi-install-unavailable" role="status" aria-label="Headway Chrome Web Store approval pending">
                <span className="hi-chrome-symbol" aria-hidden="true"><span/></span>
                <span>Store approval pending</span>
                <span className="hi-download-arrow" aria-hidden="true">◷</span>
              </div>
            )}
            <div className="hi-quick-facts">
              <span><span className="hi-fact-symbol" aria-hidden="true">◉</span> Desktop Chrome</span>
              <span><span className="hi-fact-symbol" aria-hidden="true">◷</span> One time setup</span>
            </div>
          </div>

          <div className="hi-flow" aria-label="Installation overview">
            <div className="hi-flow-item">
              <span className="hi-flow-icon" aria-hidden="true">▣</span>
              <strong>Open store</strong>
              <small>Use the install button</small>
            </div>
            <span className="hi-flow-arrow" aria-hidden="true">→</span>
            <div className="hi-flow-item">
              <span className="hi-flow-icon" aria-hidden="true"><span className="hi-chrome-symbol hi-chrome-small"><span/></span></span>
              <strong>Add to Chrome</strong>
              <small>Review permissions</small>
            </div>
            <span className="hi-flow-arrow" aria-hidden="true">→</span>
            <div className="hi-flow-item">
              <span className="hi-flow-icon" aria-hidden="true">▣</span>
              <strong>Allow camera</strong>
              <small>Then calibrate</small>
            </div>
          </div>

          <p className="hi-store-status" role="status">
            {storeUrl
              ? 'Chrome Web Store will ask you to confirm installation and permissions. Your browser stays in control.'
              : 'Direct installation is not available until Headway passes Chrome Web Store review. No ZIP download or developer mode setup is required once it is published.'}
          </p>
          <details className="hi-install-guide">
            <summary><span className="hi-guide-icon" aria-hidden="true">▤</span> See installation guide <span className="hi-guide-chevron" aria-hidden="true">⌄</span></summary>
            <ol>
              <li><strong>Open the listing.</strong> Once Headway is published, select <strong>Install extension</strong> to open its official Chrome Web Store page.</li>
              <li><strong>Choose Add to Chrome.</strong> Review the permissions, then select <strong>Add extension</strong> if you consent.</li>
              <li><strong>Open and pin Headway.</strong> Choose it from Chrome’s Extensions menu and pin it if you like.</li>
              <li><strong>Enable camera and calibrate.</strong> Start head tracking only when ready and follow the setup for movement and mouth clicks.</li>
            </ol>
            {!storeUrl && <p>Headway is a separate hands free browsing extension. The team must first publish a reviewed Chrome Web Store listing.</p>}
            <a href="/install" className="hi-full-guide-link">Open the full installation page <span aria-hidden="true">↗</span></a>
          </details>
        </section>

        <div className="hi-preview" aria-hidden="true">
          <div className="hi-preview-window">
            <div className="hi-preview-topbar">
              <div className="hi-preview-brand"><span className="hi-preview-logo">✚</span><strong>Headway</strong></div>
              <span className="hi-preview-window-controls">−　×</span>
            </div>
            <div className="hi-preview-line">
              <span className="hi-preview-setting-icon">✥</span>
              <span className="hi-preview-setting-text"><strong>Head pointer</strong><small>Move the pointer with your head</small></span>
              <span className="hi-preview-switch"><i/></span>
            </div>
            <div className="hi-preview-line">
              <span className="hi-preview-setting-icon">◡</span>
              <span className="hi-preview-setting-text"><strong>Click calibration</strong><small>Set your mouth click</small></span>
              <span className="hi-preview-chevron">›</span>
            </div>
            <div className="hi-preview-line hi-preview-sensitivity">
              <span className="hi-preview-setting-icon">☷</span>
              <span className="hi-preview-setting-text"><strong>Sensitivity</strong><small>Pointer speed and steadiness</small></span>
              <div className="hi-preview-range"><i/></div>
            </div>
          </div>
          <span className="hi-preview-sparkle hi-preview-sparkle-a">✦</span>
          <span className="hi-preview-sparkle hi-preview-sparkle-b">✧</span>
        </div>
      </div>

      <div className="hi-benefits">
        <section className="hi-benefit-card" aria-labelledby="hi-permissions-heading">
          <div className="hi-benefit-header">
            <span className="hi-benefit-icon hi-benefit-purple" aria-hidden="true">♢</span>
            <div>
              <h3 id="hi-permissions-heading">What you will need to allow</h3>
              <p>These permissions let Headway follow your movement and interact with websites.</p>
            </div>
          </div>
          <div className="hi-pill-row" aria-label="Permissions requested">
            <span>◎ Website access</span>
            <span>▣ Camera access</span>
            <span>↖ Pointer control</span>
          </div>
          <p className="hi-permission-note">For some clicks, Chrome may ask you to allow debugging. You remain in control of these permissions.</p>
        </section>

        <section className="hi-benefit-card hi-after-card" aria-labelledby="hi-after-heading">
          <div className="hi-benefit-header">
            <span className="hi-benefit-icon hi-benefit-green" aria-hidden="true">✦</span>
            <div>
              <h3 id="hi-after-heading">What you can try after installing</h3>
              <ul className="hi-benefit-list">
                <li><span aria-hidden="true">✓</span> Move the pointer with your head</li>
                <li><span aria-hidden="true">✓</span> Click with a mouth gesture</li>
                <li><span aria-hidden="true">✓</span> Adjust speed and comfort settings</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      <p className="hi-download-fallback">
        Headway works alongside Sauti. Your private voice profile is not shared with Headway. Browser installation requires your explicit approval.
      </p>
      <div className="hi-bottom-actions">
        <button type="button" className="hi-back-button" onClick={onBack}><span aria-hidden="true">←</span> Back to recognition</button>
        <button type="button" className="hi-review-button" onClick={onReview}>Review setup</button>
      </div>
    </div>
  );
}
