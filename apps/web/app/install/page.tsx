import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Install Headway | Sauti Adapt',
  description: 'Install the experimental Headway hands free Chrome extension to control the pointer with head movements and mouth gestures.',
};

const RELEASE = 'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/download/headway-hackathon/Headway-Chrome-Hackathon.zip';
const RELEASE_PAGE = 'https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/releases/tag/headway-hackathon';

export default function InstallPage() {
  return (
    <main className="install-shell">
      <header className="install-header">
        <a href="/" className="install-brand"><span className="install-logo" aria-hidden="true">✚</span> Sauti Adapt</a>
        <a href="/" className="install-back">Return to voice onboarding</a>
      </header>

      <div className="install-content">
        <section className="install-hero" aria-labelledby="install-title">
          <p className="install-kicker">HACKATHON ACCESSIBILITY EXTENSION</p>
          <h1 id="install-title">Meet Headway.</h1>
          <p className="install-intro">Control your browser using head movement and mouth gestures. This is an additional input method alongside Sauti’s voice experience.</p>
          <div className="install-actions">
            <a className="install-primary" href={RELEASE} aria-label="Download Headway Chrome extension ZIP">Download Headway for Chrome <span aria-hidden="true">↓</span></a>
            <a className="install-secondary" href={RELEASE_PAGE}>View build and source</a>
          </div>
          <p className="install-note">For desktop Chrome version 128 or newer. Unzip and load the extension manually. Chrome does not allow a website to silently install an unpacked extension.</p>
        </section>

        <section className="install-steps" aria-labelledby="install-steps-heading">
          <div className="install-section-heading"><span className="install-eyebrow">ONE TIME SETUP</span><h2 id="install-steps-heading">Ready in four steps</h2></div>
          <ol>
            <li><span className="install-step-number">01</span><div><h3>Download and extract</h3><p>Download the Headway ZIP above, extract it, and locate the extracted folder containing <code>manifest.json</code> and <code>dist</code>.</p></div></li>
            <li><span className="install-step-number">02</span><div><h3>Open Chrome extensions</h3><p>Enter <code>chrome://extensions</code> into Chrome’s address bar, then enable <strong>Developer mode</strong>.</p></div></li>
            <li><span className="install-step-number">03</span><div><h3>Load Headway</h3><p>Select <strong>Load unpacked</strong> and choose the extracted folder containing <code>manifest.json</code>. Chrome will display the Headway extension and its permissions.</p></div></li>
            <li><span className="install-step-number">04</span><div><h3>Turn on and calibrate</h3><p>Open Headway from the Extensions menu. Allow camera access on a site where you want to use it. Turn on the head pointer and follow calibration for comfortable movement and clicks.</p></div></li>
          </ol>
        </section>

        <section className="install-options" aria-label="Headway testing and permissions">
          <div className="install-info-panel">
            <h2>What can I try?</h2>
            <p>Move the pointer with your head, snap to small buttons, and use a calibrated mouth opening to click. Adjust the pointer’s speed and steadiness in the extension panel.</p>
            <p>Headway’s on device summaries are currently disabled. Sauti voice command recognition and Headway are two separate extensions and are not automatically paired.</p>
          </div>
          <div className="install-info-panel">
            <h2>Know what you are enabling</h2>
            <p>Headway requests access to websites you visit. It also requests Chrome’s debugger permission to send genuine pointer clicks on websites that reject simulated ones. Chrome may show a debugging notification while this feature is active.</p>
            <p>You can switch off head tracking or real clicks in Headway. Test on non sensitive websites first, and do not enter private information while demonstrating.</p>
          </div>
        </section>

        <p className="install-support">Download unavailable? <a href={RELEASE_PAGE}>Open the release page</a> to check whether the newest build has completed. Sauti’s original voice extension remains in the repository at <code>apps/extension</code>; Headway is in <code>apps/headway</code>.</p>
      </div>
    </main>
  );
}
