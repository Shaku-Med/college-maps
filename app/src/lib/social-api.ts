import { apiCall, type ApiResult } from "@/lib/api";

export const MAX_GUESTS = 5;

export type Person = { username: string; displayName: string };
export type Friend = Person & { since: string };
export type FriendRequest = Person & { sentAt: string };

export type FriendsOverview = {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: Person[];
};

export type MeetupStatus = "invited" | "joined" | "declined" | "left";

export type MeetupMember = Person & {
  role: "host" | "guest";
  status: MeetupStatus;
  liveId?: string;
};

export type MeetupDestination = {
  kind: "member" | "place" | "pin";
  username?: string;
  liveId?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
};

export type Meetup = {
  id: string;
  visibility: "private" | "public";
  title?: string;
  startsAt?: string;
  going: number;
  note: string;
  host: Person;
  destination?: MeetupDestination;
  members: MeetupMember[];
  yourRole: "host" | "guest";
  yourStatus: MeetupStatus;
  yourLiveId?: string;
  createdAt: string;
  expiresAt: string;
  active: boolean;
};

export type NewMeetup = {
  friends: string[];
  destination: MeetupDestination;
  note?: string;
  minutes?: number;
};

export type NewPublicMeetup = {
  title: string;
  note?: string;
  destination: MeetupDestination;
  startsIn: number;
  minutes: number;
};

export type LivePass = { token: string; expiresAt: string };

const empty: FriendsOverview = { friends: [], incoming: [], outgoing: [], blocked: [] };

function unwrapMeetup(res: ApiResult<{ meetup: Meetup }>): ApiResult<Meetup> {
  return res.ok ? { ok: true, data: res.data.meetup } : res;
}

// Usernames are always lowercase; meetup ids are not, so they keep their exact spelling.
function handle(username: string) {
  return encodeURIComponent(username.trim().replace(/^@/, "").toLowerCase());
}

function meetupPath(id: string) {
  return encodeURIComponent(id.trim());
}

export const socialApi = {
  friends: async (): Promise<ApiResult<FriendsOverview>> => {
    const res = await apiCall<FriendsOverview>("/v1/friends", "GET");
    return res.ok ? { ok: true, data: { ...empty, ...res.data } } : res;
  },
  addFriend: (username: string) => apiCall<{ status: string }>("/v1/friends/requests", "POST", { username }),
  acceptFriend: (username: string) => apiCall<void>(`/v1/friends/requests/${handle(username)}/accept`, "POST"),
  removeRequest: (username: string) => apiCall<void>(`/v1/friends/requests/${handle(username)}`, "DELETE"),
  unfriend: (username: string) => apiCall<void>(`/v1/friends/${handle(username)}`, "DELETE"),
  block: (username: string) => apiCall<void>("/v1/blocks", "POST", { username }),
  unblock: (username: string) => apiCall<void>(`/v1/blocks/${handle(username)}`, "DELETE"),

  meetups: async (): Promise<ApiResult<Meetup[]>> => {
    const res = await apiCall<{ meetups: Meetup[] }>("/v1/meetups", "GET");
    return res.ok ? { ok: true, data: res.data.meetups ?? [] } : res;
  },
  createMeetup: async (meetup: NewMeetup) => unwrapMeetup(await apiCall<{ meetup: Meetup }>("/v1/meetups", "POST", meetup)),
  meetup: async (id: string) => unwrapMeetup(await apiCall<{ meetup: Meetup }>(`/v1/meetups/${meetupPath(id)}`, "GET")),
  respond: async (id: string, accept: boolean) =>
    unwrapMeetup(await apiCall<{ meetup: Meetup }>(`/v1/meetups/${meetupPath(id)}/respond`, "POST", { accept })),
  leaveMeetup: async (id: string) => unwrapMeetup(await apiCall<{ meetup: Meetup }>(`/v1/meetups/${meetupPath(id)}/leave`, "POST")),
  endMeetup: async (id: string) => unwrapMeetup(await apiCall<{ meetup: Meetup }>(`/v1/meetups/${meetupPath(id)}/end`, "POST")),
  publicMeetups: async (): Promise<ApiResult<Meetup[]>> => {
    const res = await apiCall<{ meetups: Meetup[] }>("/v1/meetups/public", "GET");
    return res.ok ? { ok: true, data: res.data.meetups ?? [] } : res;
  },
  createPublicMeetup: async (meetup: NewPublicMeetup) =>
    unwrapMeetup(await apiCall<{ meetup: Meetup }>("/v1/meetups/public", "POST", meetup)),
  joinPublicMeetup: async (id: string) =>
    unwrapMeetup(await apiCall<{ meetup: Meetup }>(`/v1/meetups/${meetupPath(id)}/join`, "POST")),
  livePass: (id: string) => apiCall<LivePass>(`/v1/meetups/${meetupPath(id)}/ticket`, "POST"),
};
