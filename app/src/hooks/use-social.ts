"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AccountState } from "@/hooks/use-account";
import { socialApi, type FriendsOverview, type Meetup } from "@/lib/social-api";

const REFRESH_MS = 30_000;

const noFriends: FriendsOverview = { friends: [], incoming: [], outgoing: [], blocked: [] };

type Social = { owner: string; friends: FriendsOverview; meetups: Meetup[]; campus: Meetup[] };

/**
 * Friends and meetups for the signed in user. It refreshes on a slow timer, and only while the tab
 * is visible, so a phone in a pocket is not making requests all day.
 */
export function useSocial(account: AccountState) {
  const user = account.status === "signed-in" ? account.user : undefined;
  const signedIn = Boolean(user && !user.needsProfile);
  const owner = signedIn ? (user?.username ?? "") : "";

  const [data, setData] = useState<Social>({ owner: "", friends: noFriends, meetups: [], campus: [] });
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!owner || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    const [friendsResult, meetupsResult, campusResult] = await Promise.all([
      socialApi.friends(),
      socialApi.meetups(),
      socialApi.publicMeetups(),
    ]);
    setData((current) => ({
      owner,
      friends: friendsResult.ok ? friendsResult.data : current.owner === owner ? current.friends : noFriends,
      meetups: meetupsResult.ok ? meetupsResult.data : current.owner === owner ? current.meetups : [],
      campus: campusResult.ok ? campusResult.data : current.owner === owner ? current.campus : [],
    }));
    loadingRef.current = false;
    setIsLoading(false);
  }, [owner]);

  useEffect(() => {
    if (!owner) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [owner, refresh]);

  const updateMeetup = useCallback((meetup: Meetup) => {
    setData((current) => {
      const rest = current.meetups.filter((m) => m.id !== meetup.id);
      const keep = meetup.active && meetup.yourStatus !== "declined" && meetup.yourStatus !== "left";
      const campus = current.campus.map((m) => (m.id === meetup.id ? meetup : m)).filter((m) => m.active);
      return { ...current, campus, meetups: meetup.visibility === "public" ? current.meetups : keep ? [meetup, ...rest] : rest };
    });
  }, []);

  // Data from a previous account is ignored instead of cleared, so signing out costs no extra render.
  const mine = data.owner === owner && owner !== "";
  const friends = mine ? data.friends : noFriends;
  const meetups = mine ? data.meetups : [];
  const campus = mine ? data.campus : [];

  // What the map button shows a dot for: invitations waiting and friend requests waiting.
  const waiting = friends.incoming.length + meetups.filter((m) => m.yourStatus === "invited").length;

  return { signedIn, friends, meetups, campus, waiting, isLoading, refresh, updateMeetup };
}
