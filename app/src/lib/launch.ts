export const LAUNCH_KEY = "launched";

/** Hides the launch splash before paint once it has played in this tab, so reloads go straight to the map. */
export const LAUNCH_SCRIPT = `(()=>{try{if(sessionStorage.getItem("${LAUNCH_KEY}"))document.documentElement.dataset.launched=""}catch{}})()`;
