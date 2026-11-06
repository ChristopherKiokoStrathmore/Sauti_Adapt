'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { HeadwayToggle, useHeadway } from '@/components/HeadwayProvider';

type Tab = 'read' | 'shop' | 'form';
const ARTICLES = [
  { title: 'A more accessible web', body: 'Digital tools should support different ways to communicate, navigate and interact. Sauti Adapt explores personalized speech, head movement, and gesture input as complementary accessibility options.' },
  { title: 'Designed with participants', body: 'Accessible experiences depend on the preferences of each participant. Calibration, comfortable pacing and predictable controls are more useful than assuming that everyone wants the same interaction method.' },
  { title: 'From research to real world', body: 'The demonstration on this website is limited to Sauti Adapt. A separately installed browser extension will be needed to control permitted third party websites.' },
];
const ITEMS = [
  { name: 'Accessible notebook', price: 650, desc: 'A sample item used for navigation practice.' },
  { name: 'Reading lamp', price: 1200, desc: 'Practice selecting and adding an item.' },
  { name: 'Keyboard stand', price: 1800, desc: 'A third sample target for head controlled pointing.' },
];

export function AccessibleWorkspace() {
  const { phase, detected } = useHeadway();
  const [tab, setTab] = useState<Tab>('read');
  const [selectedArticle, setSelectedArticle] = useState(0);
  const [large, setLarge] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [basket, setBasket] = useState<string[]>([]);
  const [formName, setFormName] = useState('');
  const [formChoice, setFormChoice] = useState('English');
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('Select an experience to explore with your preferred input.');
  const total = useMemo(() => basket.reduce((sum, item) => sum + (ITEMS.find(x => x.name === item)?.price || 0), 0), [basket]);
  const article = ARTICLES[selectedArticle];

  const speak = () => {
    if (!('speechSynthesis' in window)) { setNotice('Text to speech is not supported in this browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(article.title + '. ' + article.body);
    utterance.lang = 'en-KE';
    window.speechSynthesis.speak(utterance);
    setNotice('Reading requested. Browser audio activation may require a physical interaction.');
  };

  return <main className={'aw-shell' + (highContrast ? ' aw-contrast' : '')}>
    <header className="aw-header">
      <Link href="/" className="aw-brand"><span aria-hidden="true">✚</span> Sauti Adapt</Link>
      <div className="aw-header-actions"><HeadwayToggle compact/><Link href="/" className="aw-back">Voice onboarding</Link></div>
    </header>
    <section className="aw-hero">
      <p className="step-kicker">SAUTI ADAPT · ACCESSIBLE WORKSPACE</p>
      <h1>Explore your way.</h1>
      <p>Three real interactive examples designed to test head controlled navigation, safe selections, and ordinary keyboard or mouse input.</p>
      <div className="aw-status" role="status">
        <span className={phase === 'active' && detected ? 'aw-dot aw-live' : 'aw-dot'} aria-hidden="true"/>
        Headway {phase === 'active' ? (detected ? 'tracking' : 'waiting for a face') : phase}. {phase === 'off' ? 'Activate it above whenever you are ready.' : 'You can still use ordinary controls.'}
      </div>
    </section>
    <nav className="aw-tabs" aria-label="Accessible demonstration experiences">
      <button type="button" aria-current={tab === 'read' ? 'page' : undefined} className={tab === 'read' ? 'aw-active' : ''} onClick={() => setTab('read')}>Reading</button>
      <button type="button" aria-current={tab === 'shop' ? 'page' : undefined} className={tab === 'shop' ? 'aw-active' : ''} onClick={() => setTab('shop')}>Shopping practice</button>
      <button type="button" aria-current={tab === 'form' ? 'page' : undefined} className={tab === 'form' ? 'aw-active' : ''} onClick={() => setTab('form')}>Form practice</button>
    </nav>

    {tab === 'read' && <section className="aw-card" aria-labelledby="aw-reading-title">
      <div className="aw-card-heading"><h2 id="aw-reading-title">Read and navigate</h2><p>Choose a card and adjust how the article is displayed.</p></div>
      <div className="aw-grid">
        {ARTICLES.map((entry, index) => <button key={entry.title} type="button" className={'aw-choice' + (selectedArticle === index ? ' aw-selected' : '')} onClick={() => {setSelectedArticle(index);setNotice('Article selected: ' + entry.title);}}>
          <strong>{entry.title}</strong><span>Open article {index + 1}</span>
        </button>)}
      </div>
      <div className="aw-actions">
        <button type="button" onClick={() => setLarge(value => !value)}>{large ? 'Normal text' : 'Larger text'}</button>
        <button type="button" onClick={() => setHighContrast(value => !value)}>{highContrast ? 'Standard contrast' : 'High contrast'}</button>
        <button type="button" onClick={speak}>Read article aloud</button>
      </div>
      <article className={'aw-article' + (large ? ' aw-large' : '')}><h3>{article.title}</h3><p>{article.body}</p><p>{article.body}</p><p>Scroll this page and explore the next activity when you are ready.</p></article>
    </section>}

    {tab === 'shop' && <section className="aw-card" aria-labelledby="aw-shop-title">
      <div className="aw-card-heading"><h2 id="aw-shop-title">Shopping simulation</h2><p>This is a practice basket. No payments and no real purchases.</p></div>
      <div className="aw-grid">
        {ITEMS.map(item => <div className="aw-product" key={item.name}>
          <span aria-hidden="true" className="aw-product-art">▣</span>
          <h3>{item.name}</h3><p>{item.desc}</p><strong>KES {item.price.toLocaleString('en-KE')}</strong>
          <button type="button" onClick={() => {setBasket(current => [...current, item.name]);setNotice(item.name + ' added to the practice basket.');}}>Add to practice basket</button>
        </div>)}
      </div>
      <div className="aw-basket"><strong>Practice basket: {basket.length} items</strong><span>Sample total: KES {total.toLocaleString('en-KE')}</span><p>No checkout is available in this demonstration.</p></div>
    </section>}

    {tab === 'form' && <section className="aw-card" aria-labelledby="aw-form-title">
      <div className="aw-card-heading"><h2 id="aw-form-title">Form completion simulation</h2><p>Navigate form controls, then submit sample information stored only on this page.</p></div>
      <form className="aw-form" onSubmit={e => {e.preventDefault();setSubmitted(true);setNotice('Practice form submitted locally.');}}>
        <label htmlFor="aw-name">Optional display name
          <input type="text" id="aw-name" value={formName} onChange={e => setFormName(e.target.value)} placeholder="Use your keyboard or assistive input"/>
        </label>
        <fieldset><legend>Choose your preferred language</legend>
          {['English','Kiswahili'].map(name => <label className="aw-radio" key={name}><input type="radio" name="practice-language" checked={formChoice === name} onChange={() => setFormChoice(name)}/>{name}</label>)}
        </fieldset>
        <button type="submit">Submit practice form</button>
      </form>
      {submitted && <p className="aw-success" role="status">Practice submitted. Selected language: {formChoice}. No personal information was sent to a server.</p>}
      <p className="aw-form-hint">Typing in text fields may still require a keyboard or another assistive input. Headway is a navigation tool, not a keyboard replacement.</p>
    </section>}
    <div className="aw-feedback" role="status" aria-live="polite">{notice}</div>
    <footer className="aw-footer">Research demonstration only. Headway controls this website, not other browser tabs. Camera frames are not intentionally stored or uploaded.</footer>
  </main>;
}
