// Real clips are files in public/voice-bank and are served before this; anything else here is not a page, so it is a plain 404.
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export const GET = notFound;
export const HEAD = notFound;
