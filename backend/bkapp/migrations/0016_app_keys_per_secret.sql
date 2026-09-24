-- The first notification keys were stored under one shared name, sealed with the AUTH_SECRET of whichever
-- setup started first. A laptop got there before production, so production could not open them. Keys are
-- now stored per secret, each under a name derived from it, so that shared row is left over. Safe to run
-- more than once.

delete from app_keys where name = 'vapid';
