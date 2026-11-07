// A side panel cannot show Chrome's microphone prompt, so onboarding opens this tab
// once. Permission is granted to the extension, then the tab reports back and closes.
void (async () => {
  let granted = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    granted = true;
  } catch {
    granted = false;
  }
  await chrome.runtime.sendMessage({ type: 'HEADWAY_MIC_PERMISSION', granted }).catch(() => {});
  const msg = document.getElementById('msg');
  if (granted) {
    if (msg) msg.textContent = 'Thank you. You can go back to the Headway panel.';
    setTimeout(() => window.close(), 800);
  } else if (msg) {
    msg.textContent = 'Headway did not get the microphone. Click the icon at the right of the address bar, allow the microphone, then reload this page.';
  }
})();
export {};
