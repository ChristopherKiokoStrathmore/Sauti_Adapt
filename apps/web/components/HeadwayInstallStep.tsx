'use client';

const HEADWAY_ZIP = 'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/download/headway-hackathon/Headway-Chrome-Hackathon.zip';
const HEADWAY_RELEASE = 'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/tag/headway-hackathon';

type Props = {
  onBack: () => void;
  onReview: () => void;
};

export function HeadwayInstallStep({ onBack, onReview }: Props) {
  return (
    <div className="hi-onboarding" data-testid="headway-install-step">
      <header className="hi-heading">
        <div className="hi-heading-icon" aria-hidden="true">✚</div>
        <div>
          <p className="step-kicker">Step 5 of 5</p>
          <h2>Install Headway extension</h2>
          <p className="hi-intro">Add hands free browsing with head movement and mouth gestures. Download Headway for desktop Chrome, then follow the guided setup below.</p>
        </div>
      </header>

      <div className="hi-feature-grid">
        <section className="hi-start-card" aria-label="Install Headway on Chrome">
          <div className="hi-download-row">
            <a className="hi-download-button" href={HEADWAY_ZIP} aria-label="Download Headway Chrome extension ZIP">
              <span className="hi-chrome-symbol" aria-hidden="true"><span/></span>
              <span>Download extension</span>
              <span className="hi-download-arrow" aria-hidden="true">↗</span>
            </a>
            <div className="hi-quick-facts">
              <span><span className="hi-fact-symbol" aria-hidden="true">◉</span> Desktop Chrome</span>
              <span><span className="hi-fact-symbol" aria-hidden="true">◷</span> One time setup</span>
            </div>
          </div>

          <div className="hi-flow" aria-label="Installation overview">
            <div className="hi-flow-item">
              <span className="hi-flow-icon" aria-hidden="true">↓</span>
              <strong>Download</strong>
              <small>Extract the ZIP</small>
            </div>
            <span className="hi-flow-arrow" aria-hidden="true">→</span>
            <div className="hi-flow-item">
              <span className="hi-flow-icon" aria-hidden="true"><span className="hi-chrome-symbol hi-chrome-small"><span/></span></span>
              <strong>Add to Chrome</strong>
              <small>Load unpacked</small>
            </div>
            <span className="hi-flow-arrow" aria-hidden="true">→</span>
            <div className="hi-flow-item">
              <span className="hi-flow-icon" aria-hidden="true">▣</span>
              <strong>Allow camera</strong>
              <small>Then calibrate</small>
            </div>
          </div>

          <details className="hi-install-guide">
            <summary><span className="hi-guide-icon" aria-hidden="true">▤</span> See installation guide <span className="hi-guide-chevron" aria-hidden="true">⌄</span></summary>
            <ol>
              <li><strong>Download the ZIP above</strong> and extract its contents. Find the folder containing <code>manifest.json</code>.</li>
              <li><strong>Open Chrome extensions.</strong> Type <code>chrome://extensions</code> in your Chrome address bar, then enable <strong>Developer mode</strong>.</li>
              <li><strong>Select Load unpacked.</strong> Choose the extracted folder containing <code>manifest.json</code> and the <code>dist</code> folder.</li>
              <li><strong>Pin and open Headway.</strong> Approve only the permissions you understand, enable head tracking when ready, and calibrate your movement and mouth click.</li>
            </ol>
            <p>Chrome does not allow websites to install an unpublished extension automatically. These Chrome steps are necessary for this hackathon build.</p>
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
        Having trouble downloading? <a href={HEADWAY_RELEASE}>View the latest Headway release</a>.
        Headway works alongside Sauti. Your private voice profile is not shared with the extension.
      </p>
      <div className="hi-bottom-actions">
        <button type="button" className="hi-back-button" onClick={onBack}><span aria-hidden="true">←</span> Back to recognition</button>
        <button type="button" className="hi-review-button" onClick={onReview}>Review setup</button>
      </div>
    </div>
  );
}
