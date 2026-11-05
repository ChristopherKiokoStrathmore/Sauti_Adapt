import type { Metadata } from 'next';
import { getHeadwayStoreUrl } from '@/lib/headway-store';

export const metadata: Metadata = {
  title: 'Install Headway | Sauti Adapt',
  description: 'Install the Headway hands free Chrome extension through the official Chrome Web Store when published.',
};

export default function InstallPage() {
  const storeUrl = getHeadwayStoreUrl();
  return (
    <main className="install-shell">
      <header className="install-header">
        <a href="/" className="install-brand"><span className="install-logo" aria-hidden="true">✚</span> Sauti Adapt</a>
        <a href="/" className="install-back">Return to voice onboarding</a>
      </header>

      <div className="install-content">
        <section className="install-hero" aria-labelledby="install-title">
          <p className="install-kicker">ACCESSIBILITY EXTENSION</p>
          <h1 id="install-title">Meet Headway.</h1>
          <p className="install-intro">Control your browser using head movement and mouth gestures. Headway is an additional input method alongside Sauti’s voice experience.</p>
          <div className="install-actions">
            {storeUrl ? (
              <a className="install-primary" href={storeUrl} rel="noopener noreferrer" target="_blank" aria-label="Install Headway from Chrome Web Store">Install extension <span aria-hidden="true">↗</span></a>
            ) : (
              <div className="install-primary install-unavailable" role="status">Chrome Web Store approval pending</div>
            )}
            <a className="install-secondary" href="https://github.com/ChristopherKiokoStrathmore/Sauti_Adapt/tree/main/apps/headway" target="_blank" rel="noopener noreferrer">View extension source</a>
          </div>
          <p className="install-note">
            {storeUrl
              ? 'Open the official Chrome Web Store listing and select Add to Chrome. Review the requested permissions before confirming.'
              : 'Direct installation is not yet available. Headway needs a published, reviewed Chrome Web Store listing before users can add it directly to Chrome. This page will display an install button once the listing URL is configured.'}
          </p>
        </section>

        <section className="install-steps" aria-labelledby="install-steps-heading">
          <div className="install-section-heading"><span className="install-eyebrow">ONE TIME SETUP</span><h2 id="install-steps-heading">Ready in four steps</h2></div>
          <ol>
            <li><span className="install-step-number">01</span><div><h3>Open Chrome Web Store</h3><p>When publication is complete, select <strong>Install extension</strong> above to open the official Headway listing.</p></div></li>
            <li><span className="install-step-number">02</span><div><h3>Add to Chrome</h3><p>Select <strong>Add to Chrome</strong> and approve only permissions you understand. Chrome will ask for your confirmation.</p></div></li>
            <li><span className="install-step-number">03</span><div><h3>Open Headway</h3><p>Find Headway in Chrome’s Extensions menu. You can pin it to the toolbar for quicker access.</p></div></li>
            <li><span className="install-step-number">04</span><div><h3>Allow camera and calibrate</h3><p>On a site where you want to use it, enable head tracking and grant camera access when prompted. Calibrate movement and mouth clicks to your comfort.</p></div></li>
          </ol>
        </section>

        <section className="install-options" aria-label="Headway testing and permissions">
          <div className="install-info-panel">
            <h2>What can I try?</h2>
            <p>Move the pointer with your head, snap to small buttons, and use a calibrated mouth opening to click. Adjust the pointer’s speed and steadiness in the extension panel.</p>
            <p>Headway’s on device summaries are currently disabled. Sauti voice command recognition and Headway are separate extensions and are not automatically paired.</p>
          </div>
          <div className="install-info-panel">
            <h2>Know what you are enabling</h2>
            <p>Headway requests access to websites you visit. It also requests Chrome’s debugger permission to send pointer clicks on websites that reject simulated ones. Chrome may show a debugging notification while this feature is active.</p>
            <p>You can switch off head tracking or real clicks in Headway. Test on non sensitive websites first, and do not enter private information while demonstrating.</p>
          </div>
        </section>

        <p className="install-support">Headway runs in Chrome on desktop and requires your approval to install. The Sauti voice extension remains a separate project at <code>apps/extension</code>; Headway lives in <code>apps/headway</code>.</p>
      </div>
    </main>
  );
}
