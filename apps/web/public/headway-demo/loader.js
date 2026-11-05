import * as HumanModule from './human.esm.js';
const ctor = HumanModule.Human || HumanModule.default;
if (typeof ctor !== 'function') throw new Error('Headway model export unavailable');
window.__HeadwayHumanConstructor = ctor;
window.dispatchEvent(new Event('headway-human-ready'));
