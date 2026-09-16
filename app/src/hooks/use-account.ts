"use client";

import { useCallback, useEffect, useState } from "react";

import { API_ORIGIN, accountApi, type AccountUser } from "@/lib/api";

export type AccountState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "unreachable" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AccountUser };

export function useAccount() {
  const [state, setState] = useState<AccountState>(() => (API_ORIGIN ? { status: "loading" } : { status: "disabled" }));

  const refresh = useCallback(async () => {
    if (!API_ORIGIN) return;
    const res = await accountApi.me();
    if (res.ok) setState({ status: "signed-in", user: res.data });
    else if (res.status === 401) setState({ status: "signed-out" });
    else setState({ status: "unreachable" });
  }, []);

  useEffect(() => {
    if (!API_ORIGIN) return;
    let cancelled = false;
    accountApi.me().then((res) => {
      if (cancelled) return;
      if (res.ok) setState({ status: "signed-in", user: res.data });
      else setState({ status: res.status === 401 ? "signed-out" : "unreachable" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setUser = useCallback((user: AccountUser | null) => {
    setState(user ? { status: "signed-in", user } : { status: "signed-out" });
  }, []);

  return { state, refresh, setUser };
}
