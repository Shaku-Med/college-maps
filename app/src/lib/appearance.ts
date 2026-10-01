export const GLASS_KEY = "liquid-glass";
export const GLASS_EVENT = "liquid-glass-change";

/**
 * Runs before paint and marks the page with the device it is on, so the layout matches the app that person would
 * install: data-os is ios or android, data-device is phone on an iPhone or Android phone (tablets keep the default
 * layout), and data-liquid is set on iOS 26 and later, where Liquid Glass can be turned on. Safari 26 freezes the
 * iOS version in the user agent at 18, so its own version number is read too.
 */
export const APPEARANCE_SCRIPT = `(()=>{try{const u=navigator.userAgent,r=document.documentElement,iphone=/iPhone|iPod/.test(u),ipad=/iPad/.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1),android=/Android/.test(u);if(iphone||ipad)r.dataset.os="ios";else if(android)r.dataset.os="android";if(iphone||(android&&/Mobile/.test(u)))r.dataset.device="phone";if(iphone||ipad){const n=p=>Number((u.match(p)||[])[1]||0);if(Math.max(n(/Version\\/(\\d+)/),n(/OS (\\d+)_/))>=26){r.dataset.liquid="";if(localStorage.getItem("${GLASS_KEY}")==="on")r.dataset.glass=""}}}catch{}})()`;
