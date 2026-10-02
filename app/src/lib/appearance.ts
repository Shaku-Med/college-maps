export const GLASS_KEY = "liquid-glass";
export const GLASS_EVENT = "liquid-glass-change";

/** Tags the device before paint: data-os, data-device, and data-liquid for iOS 26 and later. */
export const APPEARANCE_SCRIPT = `(()=>{try{const u=navigator.userAgent,r=document.documentElement,iphone=/iPhone|iPod/.test(u),ipad=/iPad/.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1),android=/Android/.test(u);if(iphone||ipad)r.dataset.os="ios";else if(android)r.dataset.os="android";if(iphone||(android&&/Mobile/.test(u)))r.dataset.device="phone";if(iphone||ipad){const n=p=>Number((u.match(p)||[])[1]||0);if(Math.max(n(/Version\\/(\\d+)/),n(/OS (\\d+)_/))>=26){r.dataset.liquid="";if(localStorage.getItem("${GLASS_KEY}")==="on")r.dataset.glass=""}}}catch{}})()`;
